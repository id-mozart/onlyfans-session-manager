const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');
const https = require('https');

// Server URL - можно настроить через env или конфиг
const SERVER_URL = process.env.SERVER_URL || 'https://session-of.replit.app';

let mainWindow;
let onlyFansView;

// Map для хранения webRequest handlers по partition name (избегаем дублирования)
const webRequestHandlers = new Map();
const headerCacheTimestamps = new Map(); // Track last header generation time per session

// Map для хранения bootstrap data (xBc, platformUserId, userId) per partition
// Используется preload script'ом для установки localStorage ДО первого запроса
const sessionBootstrapData = new Map();

// ========== OFAuth Headers Generation via Server ==========
// Desktop app обращается к нашему серверу для генерации headers
// Сервер имеет OFAUTH_API_KEY и вызывает OFAuth API

// Кэш для динамических headers (чтобы не вызывать server каждый раз)
const headersCache = new Map();
const CACHE_DURATION = 10000; // 10 секунд

/**
 * Генерирует динамические OnlyFans headers через наш сервер
 * @param {string} urlPath - Путь к OnlyFans API endpoint (например: /api2/v2/users/me)
 * @param {string} userId - ID пользователя OnlyFans (опционально для публичных endpoints)
 * @returns {Promise<Object>} - Объект с headers: { sign, time, 'app-token', 'x-of-rev' }
 */
async function generateOnlyFansHeaders(urlPath, userId = null) {
  // Проверяем кэш
  const cacheKey = `${urlPath}:${userId || 'public'}`;
  const cached = headersCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return cached.headers;
  }

  try {
    // Формируем полный endpoint URL
    const fullEndpoint = `https://onlyfans.com${urlPath}`;
    
    // Подготавливаем тело запроса
    const requestBody = {
      endpoint: fullEndpoint
    };
    
    // Добавляем userId только если он указан
    if (userId) {
      requestBody.userId = String(userId);
    }

    // Обращаемся к нашему серверу для генерации headers
    const response = await fetch(`${SERVER_URL}/api/generate-ofauth-headers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`❌ Server error generating headers (${response.status}):`, errorData);
      return null;
    }

    const data = await response.json();

    if (!data.success || !data.headers) {
      console.error('❌ Invalid server response - missing headers');
      return null;
    }

    const headers = data.headers;

    // Кэшируем результат
    headersCache.set(cacheKey, {
      headers,
      timestamp: Date.now()
    });

    console.log('✅ OFAuth: headers получены от сервера для', urlPath);
    return headers;
  } catch (error) {
    console.error('❌ Ошибка получения OFAuth headers от сервера:', error);
    return null;
  }
}

// Создать главное окно
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Odinn.Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    backgroundColor: '#667eea',
    show: false
  });

  // Загрузить локальный HTML файл
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Показать окно когда готово
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Открыть DevTools в режиме разработки
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (onlyFansView) {
      onlyFansView.webContents.destroy();
      onlyFansView = null;
    }
  });
  
  // Global resize handler (set once)
  mainWindow.on('resize', () => {
    if (onlyFansView) {
      // Use content bounds to avoid window frame
      const bounds = mainWindow.getContentBounds();
      onlyFansView.setBounds({ 
        x: 0, 
        y: 0, 
        width: bounds.width, 
        height: bounds.height 
      });
    }
  });
  
  // Global ESC handler (set once)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && onlyFansView) {
      closeOnlyFansView();
    }
  });
}

// Создать BrowserView для OnlyFans
async function createOnlyFansView(sessionData) {
  // Валидация входных данных
  if (!sessionData || !sessionData.id || !sessionData.cookie) {
    throw new Error('Invalid session data');
  }

  console.log('🚀 Начинаем загрузку OnlyFans для:', sessionData.name);

  // Сообщить UI о начале загрузки
  mainWindow.webContents.send('onlyfans-loading');

  // Удалить предыдущий view если есть (с очисткой памяти)
  if (onlyFansView) {
    await closeOnlyFansView();
  }

  // Создать новый BrowserView с УНИКАЛЬНОЙ partition для каждой сессии
  const partitionName = `persist:onlyfans-${sessionData.id}`;
  
  // ========== КРИТИЧНО! Сохраняем bootstrap data ДО создания BrowserView ==========
  // Preload script будет читать эти данные через синхронный IPC
  sessionBootstrapData.set(partitionName, {
    xBc: sessionData.xBc,
    platformUserId: sessionData.platformUserId,
    userId: sessionData.userId
  });
  console.log(`[BOOTSTRAP] Сохранили data для partition: ${partitionName}`);
  
  // ========== Регистрируем preload script для этой session ==========
  const ses = session.fromPartition(partitionName);
  const bootstrapPreloadPath = path.join(__dirname, 'onlyfans-bootstrap-preload.js');
  
  // Устанавливаем preload scripts которые будут выполняться ДО загрузки страницы
  // ВАЖНО: Это должно быть сделано ДО создания BrowserView!
  ses.setPreloads([bootstrapPreloadPath]);
  console.log(`[BOOTSTRAP] Зарегистрировали preload: ${bootstrapPreloadPath}`);
  
  onlyFansView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: partitionName,
      preload: path.join(__dirname, 'browserViewPreload.js') // overlay preload
    }
  });

  // НЕ добавляем BrowserView сразу - добавим ПОСЛЕ загрузки страницы
  // mainWindow.addBrowserView(onlyFansView); // УДАЛЕНО

  // ========== КРИТИЧНО! Добавить динамические headers ко ВСЕМ запросам OnlyFans API ==========
  
  // Проверяем существует ли уже handler для этой partition (избегаем дублирования)
  if (!webRequestHandlers.has(partitionName)) {
    console.log('🔧 Настраиваем webRequest interceptor для partition:', partitionName);
    
    // Создаем async handler для перехвата запросов
    const requestInterceptor = async (details, callback) => {
      // ВАЖНО: Используем details.requestHeaders (НЕ details.headers!)
      // Использование details.headers сломает cookies!
      const requestHeaders = { ...details.requestHeaders };
      
      // Определяем является ли это API запросом
      const isApiRequest = details.url.includes('/api2/') || details.url.includes('/api/');
      
      // ========== Динамические headers через OFAuth API (для API запросов) ==========
      if (isApiRequest && sessionData.userId) {
        try {
          // Извлекаем путь из URL
          const urlObj = new URL(details.url);
          const urlPath = urlObj.pathname + urlObj.search;
          
          // Генерируем динамические headers через OFAuth
          // OFAuth НЕ требует передавать x-bc или userAgent - только endpoint и user_id
          const dynamicHeaders = await generateOnlyFansHeaders(urlPath, sessionData.userId);
          
          if (dynamicHeaders) {
            // Добавляем динамические headers от OFAuth
            if (dynamicHeaders.sign) requestHeaders['sign'] = dynamicHeaders.sign;
            if (dynamicHeaders.time) requestHeaders['time'] = String(dynamicHeaders.time);
            if (dynamicHeaders['app-token']) requestHeaders['app-token'] = dynamicHeaders['app-token'];
            if (dynamicHeaders['x-of-rev']) requestHeaders['x-of-rev'] = dynamicHeaders['x-of-rev'];
            
            // КРИТИЧНО: x-bc добавляем из sessionData (device fingerprint)
            if (sessionData.xBc) {
              requestHeaders['x-bc'] = sessionData.xBc;
            }
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`🔑 Добавлены OFAuth динамические headers для ${urlPath}`);
            }
          } else {
            // Fallback на статические headers если OFAuth недоступен
            if (sessionData.xBc) {
              requestHeaders['x-bc'] = sessionData.xBc;
            }
            requestHeaders['app-token'] = '33d57ade8c02dbc5a333db99ff9ae26a';
          }
        } catch (error) {
          console.error('❌ Ошибка генерации динамических headers:', error);
          // Fallback на статические headers
          if (sessionData.xBc) {
            requestHeaders['x-bc'] = sessionData.xBc;
          }
          requestHeaders['app-token'] = '33d57ade8c02dbc5a333db99ff9ae26a';
        }
      } else if (sessionData.xBc) {
        // Для не-API запросов используем статический x-bc
        requestHeaders['x-bc'] = sessionData.xBc;
      }
      
      // ========== Статические headers (всегда добавляем) ==========
      
      // КРИТИЧНО: НЕ добавляем user-id header!
      // Анализ успешных запросов показал что user-id header НЕ отправляется браузером
      // User ID передается через cookie auth_id, а НЕ через отдельный header
      // Ранее я ошибочно добавлял этот header, что вызывало 400 ошибки
      // УДАЛЕНО: requestHeaders['user-id'] = sessionData.userId
      
      // 2. User-Agent (на всякий случай, хотя уже установлен через setUserAgent)
      if (sessionData.userAgent && !requestHeaders['User-Agent']) {
        requestHeaders['User-Agent'] = sessionData.userAgent;
      }
      
      // 3. Дополнительные headers для OnlyFans API
      if (isApiRequest) {
        if (!requestHeaders['Referer']) {
          requestHeaders['Referer'] = 'https://onlyfans.com/';
        }
        // КРИТИЧНО: НЕ добавляем Origin header для API запросов!
        // OnlyFans возвращает 400 если Origin присутствует в API запросах
        // Анализ успешных запросов показал, что браузер НЕ отправляет Origin для same-origin запросов
        // Удалено: if (!requestHeaders['Origin']) { requestHeaders['Origin'] = 'https://onlyfans.com'; }
        if (!requestHeaders['Accept']) {
          requestHeaders['Accept'] = 'application/json, text/plain, */*';
        }
        // Modern browser headers (from real OnlyFans browser traffic analysis)
        if (!requestHeaders['Accept-Encoding']) {
          requestHeaders['Accept-Encoding'] = 'gzip, deflate, br, zstd';
        }
        if (!requestHeaders['Accept-Language']) {
          requestHeaders['Accept-Language'] = 'en-GB,en;q=0.9,ru-GB;q=0.8';
        }
        if (!requestHeaders['Priority']) {
          requestHeaders['Priority'] = 'u=1, i';
        }
        // Security fetch headers
        if (!requestHeaders['Sec-Fetch-Dest']) {
          requestHeaders['Sec-Fetch-Dest'] = 'empty';
        }
        if (!requestHeaders['Sec-Fetch-Mode']) {
          requestHeaders['Sec-Fetch-Mode'] = 'cors';
        }
        if (!requestHeaders['Sec-Fetch-Site']) {
          requestHeaders['Sec-Fetch-Site'] = 'same-origin';
        }
        // Chrome User Agent Client Hints (помогают с browser fingerprinting)
        if (!requestHeaders['sec-ch-ua']) {
          requestHeaders['sec-ch-ua'] = '"Chromium";v="136", "Not-A.Brand";v="99"';
        }
        if (!requestHeaders['sec-ch-ua-mobile']) {
          requestHeaders['sec-ch-ua-mobile'] = '?0';
        }
        if (!requestHeaders['sec-ch-ua-platform']) {
          requestHeaders['sec-ch-ua-platform'] = '"Windows"';
        }
      }
      
      // ========== DEBUG: Логируем итоговые headers для API запросов ==========
      if (isApiRequest) {
        console.log('📤 [DEBUG] Отправка API запроса к OnlyFans:');
        console.log('   URL:', details.url);
        console.log('   x-bc:', requestHeaders['x-bc']);
        console.log('   app-token:', requestHeaders['app-token']);
        console.log('   sign:', requestHeaders['sign']);
        console.log('   time:', requestHeaders['time']);
        console.log('   Origin:', requestHeaders['Origin'] || '(не установлен - правильно!)');
        console.log('   Referer:', requestHeaders['Referer']);
      }
      
      // Передаём модифицированные headers обратно
      callback({ 
        cancel: false, 
        requestHeaders: requestHeaders 
      });
    };
    
    // Регистрируем interceptor
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['https://onlyfans.com/*', 'https://*.onlyfans.com/*'] },
      requestInterceptor
    );
    
    // Сохраняем handler для возможного удаления позже
    webRequestHandlers.set(partitionName, requestInterceptor);
    console.log('✅ webRequest interceptor установлен (динамические + статические headers)');
  } else {
    console.log('ℹ️ webRequest interceptor уже установлен для этой partition');
  }
  
  // ========== КРИТИЧНО! Session Cookie Persistence ==========
  // OnlyFans использует session cookies которые не сохраняются между перезапусками
  // Конвертируем session cookies в persistent cookies с expirationDate
  ses.cookies.on('changed', async (event, cookie, cause, removed) => {
    // Игнорируем удалённые cookies
    if (removed) return;
    
    // Если это session cookie (без expirationDate) - конвертируем в persistent
    if (cookie.session) {
      try {
        const expirationDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 дней
        
        // Устанавливаем cookie с expirationDate (делаем persistent)
        await ses.cookies.set({
          url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain}${cookie.path}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite || 'unspecified',
          expirationDate: expirationDate
        });
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`🔄 Converted session cookie to persistent: ${cookie.name}`);
        }
      } catch (error) {
        console.error('❌ Ошибка конвертации session cookie:', error);
      }
    }
  });
  
  console.log('✅ Session cookie persistence handler установлен');

  // ========== КРИТИЧНО! Установить User-Agent ДО загрузки ==========
  if (sessionData.userAgent) {
    console.log('🔧 Устанавливаем User-Agent:', sessionData.userAgent);
    onlyFansView.webContents.setUserAgent(sessionData.userAgent);
    
    // ПРОВЕРЯЕМ что User-Agent установлен
    const actualUA = onlyFansView.webContents.getUserAgent();
    console.log('🔍 VERIFICATION - User-Agent установлен:', actualUA === sessionData.userAgent ? '✅ ДА' : '❌ НЕТ');
    if (actualUA !== sessionData.userAgent) {
      console.error('❌ User-Agent НЕ совпадает!');
      console.error('   Ожидается:', sessionData.userAgent);
      console.error('   Реальный:', actualUA);
    }
  } else {
    console.warn('⚠️ User-Agent отсутствует в sessionData!');
  }

  // ========== КРИТИЧНО! Очистить partition ПЕРЕД установкой cookies ==========
  // ПРОБЛЕМА: Partition переиспользуется и старые cookies смешиваются с новыми
  // РЕШЕНИЕ: Всегда очищаем partition перед установкой новых cookies
  console.log('🧹 Очищаем partition перед установкой cookies...');
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'sessionstorage', 'filesystem', 'indexdb', 'serviceworkers', 'cachestorage']
  });
  
  // Проверяем что cookies действительно удалились
  const cookiesBeforeSet = await ses.cookies.get({ url: 'https://onlyfans.com' });
  console.log(`🔍 VERIFICATION - Cookies в partition после очистки: ${cookiesBeforeSet.length}`);
  if (cookiesBeforeSet.length > 0) {
    console.warn('⚠️ Обнаружены остаточные cookies после clearStorageData:');
    cookiesBeforeSet.forEach(c => console.warn(`   - ${c.name}`));
    // Force дополнительная очистка
    await ses.clearCache();
    await ses.flushStorageData();
    console.log('🧹 Выполнена дополнительная очистка (clearCache + flushStorageData)');
  } else {
    console.log('✅ Partition полностью чистая, готова к установке новых cookies');
  }

  // Установить cookies перед загрузкой
  try {
    console.log('🍪 Устанавливаем cookies...');
    await setOnlyFansCookies(sessionData);
    console.log('✅ Cookies установлены, загружаем OnlyFans...');
    
    // Создаём promise для отслеживания загрузки с таймаутом
    let loadFinished = false;
    
    // Обработчики событий загрузки (устанавливаем ДО loadURL)
    onlyFansView.webContents.on('did-finish-load', async () => {
      // ========== localStorage устанавливается через preload bootstrap system! ==========
      // Preload script выполнился ДО загрузки OnlyFans, поэтому localStorage уже установлен
      
      // При первой загрузке - показываем BrowserView
      if (!loadFinished) {
        loadFinished = true;
        console.log('✅ OnlyFans загружен - показываем BrowserView');
      
        // Добавляем BrowserView и устанавливаем размеры
        mainWindow.addBrowserView(onlyFansView);
        const bounds = mainWindow.getContentBounds();
        onlyFansView.setBounds({ 
          x: 0, 
          y: 0, 
          width: bounds.width, 
          height: bounds.height 
        });
        
        // ========== АВТОМАТИЧЕСКИ ОТКРЫВАЕМ DEVTOOLS ДЛЯ ОТЛАДКИ ==========
        onlyFansView.webContents.openDevTools({ mode: 'detach' });
        console.log('🔧 DevTools открыты автоматически для отладки');
        
        mainWindow.webContents.send('onlyfans-loaded');
      }
      
      // ========== ВНЕДРЯЕМ/ПЕРЕУСТАНАВЛИВАЕМ OVERLAY ПРИ КАЖДОЙ ЗАГРУЗКЕ ==========
      console.log('🎨 Внедряем overlay в OnlyFans страницу...');
      
      // ========== ВНЕДРЯЕМ OVERLAY ВНУТРЬ ONLYFANS СТРАНИЦЫ ==========
      try {
        const overlayHTML = `
          <div id="desktop-overlay" style="
            position: fixed;
            top: 1rem;
            right: 1rem;
            z-index: 999999;
            display: flex;
            gap: 0.75rem;
            flex-direction: column;
            align-items: flex-end;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          ">
            <!-- Session info -->
            <div style="
              background: rgba(15, 23, 42, 0.95);
              backdrop-filter: blur(10px);
              border: 1px solid rgba(148, 163, 184, 0.3);
              border-radius: 8px;
              padding: 0.75rem 1rem;
              color: #e2e8f0;
              font-size: 0.875rem;
              font-weight: 600;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
              display: flex;
              align-items: center;
              gap: 0.5rem;
            ">
              <div style="
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                font-size: 0.875rem;
                border: 2px solid rgba(255, 255, 255, 0.2);
              ">${sessionData.name.charAt(0).toUpperCase()}</div>
              <div>${sessionData.name}</div>
            </div>
            
            <!-- Control buttons -->
            <div style="display: flex; gap: 0.5rem;">
              <button id="desktop-devtools-btn" style="
                padding: 0.75rem 1.25rem;
                background: rgba(30, 41, 59, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(148, 163, 184, 0.3);
                border-radius: 8px;
                color: white;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
              ">🔧 DevTools</button>
              
              <button id="desktop-close-btn" style="
                padding: 0.75rem 1.25rem;
                background: rgba(220, 38, 38, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(239, 68, 68, 0.3);
                border-radius: 8px;
                color: white;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
              ">✕ Закрыть</button>
            </div>
          </div>
        `;
        
        // Внедрить HTML и JavaScript отдельно (innerHTML НЕ выполняет <script> теги!)
        await onlyFansView.webContents.executeJavaScript(`
          (function() {
            // Удалить старый overlay если есть
            const oldOverlay = document.getElementById('desktop-overlay');
            if (oldOverlay) oldOverlay.remove();
            
            // Добавить новый overlay (только HTML, без <script>)
            const div = document.createElement('div');
            div.innerHTML = \`${overlayHTML.replace(/`/g, '\\`')}\`;
            document.body.appendChild(div.firstElementChild);
            
            console.log('✅ [DESKTOP] Overlay HTML внедрён');
            
            // ВАЖНО: Выполнить JavaScript для overlay (addEventListener и т.д.)
            // Hover effects
            const buttons = document.querySelectorAll('#desktop-overlay button');
            buttons.forEach(btn => {
              btn.addEventListener('mouseenter', () => {
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4)';
              });
              btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
                btn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
              });
            });
            
            // Button click handlers (используем preload API)
            const devToolsBtn = document.getElementById('desktop-devtools-btn');
            if (devToolsBtn) {
              devToolsBtn.addEventListener('click', () => {
                console.log('[DESKTOP] DevTools button clicked');
                if (window.desktopOverlay) {
                  window.desktopOverlay.toggleDevTools();
                } else {
                  console.error('[DESKTOP] window.desktopOverlay не определён!');
                }
              });
            }
            
            const closeBtn = document.getElementById('desktop-close-btn');
            if (closeBtn) {
              closeBtn.addEventListener('click', () => {
                console.log('[DESKTOP] Close button clicked');
                if (window.desktopOverlay) {
                  window.desktopOverlay.closeOnlyFans();
                } else {
                  console.error('[DESKTOP] window.desktopOverlay не определён!');
                }
              });
            }
            
            // ESC key to close
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                console.log('[DESKTOP] ESC key pressed');
                if (window.desktopOverlay) {
                  window.desktopOverlay.closeOnlyFans();
                }
              }
            });
            
            console.log('✅ [DESKTOP] Overlay event handlers установлены, window.desktopOverlay:', !!window.desktopOverlay);
            return true;
          })();
        `);
        
        console.log('✅ Overlay внедрён в OnlyFans страницу');
        
      } catch (error) {
        console.error('❌ Ошибка внедрения overlay:', error);
      }
    });

    onlyFansView.webContents.on('did-fail-load', async (event, errorCode, errorDescription) => {
      if (loadFinished) return;
      loadFinished = true;
      console.error('❌ Ошибка загрузки OnlyFans:', errorCode, errorDescription);
      mainWindow.webContents.send('onlyfans-error', errorDescription);
      
      // Очистка при ошибке
      if (onlyFansView) {
        await closeOnlyFansView();
      }
    });

    // Начинаем загрузку (BrowserView ещё не показан)
    // ВАЖНО: Загружаем ЗАЩИЩЁННУЮ страницу (профиль) вместо главной, чтобы сразу проверить аутентификацию
    // ПРИМЕЧАНИЕ: x-bc автоматически добавляется через webRequest interceptor (строка ~217)
    // localStorage будет установлен в did-finish-load callback
    console.log('🌐 Загружаем https://onlyfans.com/my/profile ...');
    await onlyFansView.webContents.loadURL('https://onlyfans.com/my/profile');
    
    // Таймаут 30 секунд на загрузку
    setTimeout(async () => {
      if (!loadFinished && onlyFansView) {
        loadFinished = true;
        console.error('⏱️ Таймаут загрузки OnlyFans (30 секунд)');
        mainWindow.webContents.send('onlyfans-error', 'Таймаут загрузки (30 сек)');
        
        // Очистка
        if (onlyFansView) {
          await closeOnlyFansView();
        }
      }
    }, 30000);
    
  } catch (error) {
    console.error('❌ Ошибка установки cookies или загрузки:', error);
    mainWindow.webContents.send('onlyfans-error', error.message);
    
    // Очистка при ошибке
    if (onlyFansView) {
      onlyFansView.webContents.destroy();
      onlyFansView = null;
    }
    throw error;
  }

  // Открыть DevTools для OnlyFans view в dev режиме
  if (process.env.NODE_ENV === 'development') {
    onlyFansView.webContents.openDevTools();
  }
}

// Закрыть OnlyFans view и вернуться к главному интерфейсу
async function closeOnlyFansView() {
  if (onlyFansView) {
    try {
      // 1. Remove view from window FIRST
      mainWindow.removeBrowserView(onlyFansView);
      
      // 2. Get partition name for cleanup
      const partitionName = onlyFansView.webContents.session.partition;
      
      // 2.5. Clear bootstrap data to prevent credential leaks
      if (sessionBootstrapData.has(partitionName)) {
        sessionBootstrapData.delete(partitionName);
        console.log(`[BOOTSTRAP] Очистили data для partition: ${partitionName}`);
      }
      
      // 3. Remove webRequest handlers to prevent leaks
      if (webRequestHandlers.has(partitionName)) {
        console.log('🧹 Removing webRequest handlers for partition:', partitionName);
        const session = onlyFansView.webContents.session;
        // Pass null to remove ALL handlers
        session.webRequest.onBeforeSendHeaders(null);
        session.webRequest.onHeadersReceived(null);
        webRequestHandlers.delete(partitionName);
      }
      
      // 4. Clear header cache for this session
      const sessionId = partitionName.replace('persist:onlyfans-', '');
      headerCacheTimestamps.delete(sessionId);
      
      // 5. Clear session data to free memory
      const viewSession = onlyFansView.webContents.session;
      console.log('🧹 Clearing session data for partition...');
      await viewSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'cachestorage', 'filesystem', 'indexdb']
      });
      
      // 6. Force close webContents (fixes memory leak)
      onlyFansView.webContents.close();
      
      // 7. Destroy and nullify
      onlyFansView.webContents.destroy();
      onlyFansView = null;
      
      // 8. Force garbage collection if available
      if (global.gc) {
        console.log('♻️ Running garbage collection...');
        global.gc();
      }
      
      console.log('✅ OnlyFans view закрыт и память полностью очищена');
      // Notify renderer that view is closed
      mainWindow.webContents.send('onlyfans-closed');
    } catch (error) {
      console.error('⚠️ Error during cleanup:', error);
      // Still nullify the view
      onlyFansView = null;
      mainWindow.webContents.send('onlyfans-closed');
    }
  }
}

// Установить cookies для OnlyFans
async function setOnlyFansCookies(sessionData) {
  const partitionName = `persist:onlyfans-${sessionData.id}`;
  const ses = session.fromPartition(partitionName);
  
  // Очистить ВСЕ данные partition перед установкой новых cookies
  try {
    // КРИТИЧНО: Очищаем всё КРОМЕ localStorage (его установим позже)
    // Не очищаем localStorage здесь т.к. его нужно установить ДО загрузки страницы
    await ses.clearStorageData({
      storages: ['cookies', 'cachestorage', 'filesystem', 'indexdb']
    });
    console.log('🧹 Partition очищен (кроме localStorage - его установим отдельно)');
  } catch (error) {
    console.warn('⚠️ Не удалось очистить partition:', error);
  }
  
  // ========== ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ==========
  console.log('📋 RAW COOKIE STRING:', sessionData.cookie);
  console.log('📏 Cookie length:', sessionData.cookie.length);
  
  // Парсим cookie string (БЕЗ пробела после точки с запятой!)
  const cookieStrings = sessionData.cookie.split(';').filter(s => s.trim().length > 0);
  
  console.log('🔢 Parsed cookies count (before deduplication):', cookieStrings.length);
  
  // If no cookies to set, return early
  if (cookieStrings.length === 0) {
    console.log('⚠️ No cookies to set (empty cookie string)');
    return;
  }
  
  // ========== КРИТИЧНО! ДЕДУПЛИКАЦИЯ COOKIES ==========
  // ПРОБЛЕМА: Cookie string может содержать дубликаты (fp=old; fp=new)
  // РЕШЕНИЕ: Парсим в Map, оставляем только одно значение для каждого имени
  const cookieMap = new Map();
  
  for (const cookieStr of cookieStrings) {
    const [name, ...valueParts] = cookieStr.split('=');
    const value = valueParts.join('=');
    
    if (!name || !value) {
      console.warn('⚠️ Skipping invalid cookie:', cookieStr);
      continue;
    }
    
    const cookieName = name.trim();
    const cookieValue = value.trim();
    
    // КРИТИЧНО: Для fp используем sessionData.xBc (должно совпадать с x-bc header!)
    if (cookieName === 'fp') {
      if (sessionData.xBc) {
        cookieMap.set('fp', sessionData.xBc);
        console.log(`🔧 FORCED fp to match x-bc: ${sessionData.xBc.substring(0, 20)}...`);
      } else {
        cookieMap.set('fp', cookieValue);
        console.warn('⚠️ No xBc in sessionData, using fp from cookie string');
      }
    } 
    // Для остальных cookies - оставляем последнее значение (самое свежее)
    else {
      if (cookieMap.has(cookieName)) {
        console.log(`🔄 Replacing duplicate cookie: ${cookieName}`);
      }
      cookieMap.set(cookieName, cookieValue);
    }
  }
  
  console.log(`✅ Deduplicated cookies count: ${cookieMap.size}`);
  console.log('📝 Final cookies:', Array.from(cookieMap.keys()));
  
  // ========== УСТАНОВКА COOKIES ==========
  const cookiePromises = [];
  let successCount = 0;
  let failCount = 0;

  for (const [name, value] of cookieMap) {
    const cookieDetails = {
      url: 'https://onlyfans.com',
      name: name,
      value: value,
      path: '/',
      secure: true,
      httpOnly: false, // ВАЖНО: OnlyFans читает cookies из JavaScript
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    };

    console.log(`🍪 Setting cookie: ${name} = ${value.substring(0, 20)}...`);

    cookiePromises.push(
      ses.cookies.set(cookieDetails)
        .then(() => {
          console.log('✅ Set cookie:', name);
          successCount++;
          return true;
        })
        .catch(error => {
          console.error('❌ Error setting cookie:', name, error.message);
          failCount++;
          return null;
        })
    );
  }

  await Promise.all(cookiePromises);
  
  console.log(`✅ Cookies установлено: ${successCount}, ошибок: ${failCount}`);
  
  // Проверяем что cookies действительно установлены
  const installedCookies = await ses.cookies.get({ url: 'https://onlyfans.com' });
  console.log('🔍 VERIFICATION - Cookies в partition после установки:', installedCookies.length);
  installedCookies.forEach(c => {
    console.log(`   ✓ ${c.name} = ${c.value.substring(0, 20)}...`);
  });
  
  // КРИТИЧНО: Проверяем что fp совпадает с x-bc
  const fpCookie = installedCookies.find(c => c.name === 'fp');
  if (fpCookie && sessionData.xBc) {
    if (fpCookie.value === sessionData.xBc) {
      console.log('✅ VERIFICATION - fp cookie matches x-bc fingerprint!');
    } else {
      console.error('❌ CRITICAL - fp cookie DOES NOT match x-bc!');
      console.error(`   fp cookie: ${fpCookie.value}`);
      console.error(`   x-bc:      ${sessionData.xBc}`);
    }
  }
  
  // If too many failures, clear partition and throw
  if (failCount > cookieMap.size / 2) {
    console.error('❌ Слишком много ошибок при установке cookies, очищаем partition');
    await ses.clearStorageData();
    throw new Error(`Failed to set ${failCount} out of ${cookieMap.size} cookies`);
  }
}

// ========== IPC Handler for Bootstrap Data (Synchronous) ==========
// Preload script вызывает это синхронно для получения bootstrap data
ipcMain.on('of:get-bootstrap-data', (event) => {
  try {
    // Получаем partition из sender
    const partition = event.sender.session.partition;
    const bootstrapData = sessionBootstrapData.get(partition);
    
    if (!bootstrapData) {
      console.warn(`[BOOTSTRAP IPC] No data found for partition: ${partition}`);
      event.returnValue = null;
      return;
    }
    
    console.log(`[BOOTSTRAP IPC] Returning data for partition: ${partition}`);
    event.returnValue = bootstrapData;
  } catch (error) {
    console.error('[BOOTSTRAP IPC] Error:', error);
    event.returnValue = null;
  }
});

// IPC Handlers
ipcMain.handle('open-onlyfans', async (event, sessionData) => {
  try {
    console.log('📱 Открываем OnlyFans для:', sessionData.name);
    await createOnlyFansView(sessionData);
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка открытия OnlyFans:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-onlyfans', async () => {
  try {
    closeOnlyFansView();
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка закрытия OnlyFans:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-platform', async () => {
  return {
    platform: process.platform,
    isElectron: true,
    appVersion: app.getVersion()
  };
});

ipcMain.handle('toggle-devtools', async () => {
  try {
    if (onlyFansView && onlyFansView.webContents) {
      if (onlyFansView.webContents.isDevToolsOpened()) {
        onlyFansView.webContents.closeDevTools();
      } else {
        onlyFansView.webContents.openDevTools();
      }
      return { success: true };
    }
    return { success: false, error: 'No OnlyFans view active' };
  } catch (error) {
    console.error('❌ Ошибка toggle DevTools:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handler для загрузки sessions (bypasses CORS)
ipcMain.handle('fetch-sessions', async (event, serverUrl) => {
  try {
    console.log('📡 Fetching sessions from:', serverUrl);
    
    const response = await fetch(`${serverUrl}/api/sessions`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const sessions = await response.json();
    console.log(`✅ Loaded ${sessions.length} sessions`);
    return { success: true, sessions };
  } catch (error) {
    console.error('❌ Error fetching sessions:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handler для проверки подключения к серверу
ipcMain.handle('test-connection', async (event, serverUrl) => {
  try {
    console.log('🔌 Testing connection to:', serverUrl);
    
    const response = await fetch(`${serverUrl}/api/sessions`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    console.log('✅ Connection successful');
    return { success: true };
  } catch (error) {
    console.error('❌ Connection failed:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handler для синхронизации sessions
ipcMain.handle('sync-sessions', async (event, serverUrl) => {
  try {
    console.log('🔄 Syncing sessions from:', serverUrl);
    
    const response = await fetch(`${serverUrl}/api/sync-sessions`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();
    console.log(`✅ Sync complete: ${result.updated} updated, ${result.created} created`);
    return { success: true, result };
  } catch (error) {
    console.error('❌ Error syncing sessions:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handlers для overlay (из BrowserView)
ipcMain.on('overlay-toggle-devtools', () => {
  console.log('🔧 [IPC] Overlay: Toggle DevTools');
  if (onlyFansView && onlyFansView.webContents) {
    if (onlyFansView.webContents.isDevToolsOpened()) {
      onlyFansView.webContents.closeDevTools();
    } else {
      onlyFansView.webContents.openDevTools();
    }
  }
});

ipcMain.on('overlay-close-onlyfans', () => {
  console.log('✕ [IPC] Overlay: Close OnlyFans');
  closeOnlyFansView();
});

// App lifecycle
app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown
app.on('before-quit', () => {
  if (onlyFansView) {
    onlyFansView.webContents.destroy();
  }
});

console.log('🚀 OnlyFans Session Manager Desktop v' + app.getVersion());
console.log('🌐 Подключение к серверу:', SERVER_URL);
