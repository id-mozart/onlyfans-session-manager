const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');

// Server URL - можно настроить через env или конфиг
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

let mainWindow;
let onlyFansView;

// Map для хранения webRequest handlers по partition name (избегаем дублирования)
const webRequestHandlers = new Map();

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

  // Удалить предыдущий view если есть
  if (onlyFansView) {
    mainWindow.removeBrowserView(onlyFansView);
    onlyFansView.webContents.destroy();
    onlyFansView = null;
  }

  // Создать новый BrowserView с УНИКАЛЬНОЙ partition для каждой сессии
  const partitionName = `persist:onlyfans-${sessionData.id}`;
  onlyFansView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: partitionName,
      preload: path.join(__dirname, 'browserViewPreload.js') // ← Добавляем preload!
    }
  });

  // НЕ добавляем BrowserView сразу - добавим ПОСЛЕ загрузки страницы
  // mainWindow.addBrowserView(onlyFansView); // УДАЛЕНО

  // ========== КРИТИЧНО! Добавить x-bc header ко ВСЕМ запросам OnlyFans API ==========
  const ses = session.fromPartition(partitionName);
  
  // Проверяем существует ли уже handler для этой partition (избегаем дублирования)
  if (!webRequestHandlers.has(partitionName)) {
    console.log('🔧 Настраиваем webRequest interceptor для partition:', partitionName);
    
    // Создаем handler для перехвата запросов
    const requestInterceptor = (details, callback) => {
      // ВАЖНО: Используем details.requestHeaders (НЕ details.headers!)
      // Использование details.headers сломает cookies!
      const requestHeaders = { ...details.requestHeaders };
      
      // 1. КРИТИЧНО: x-bc header для OnlyFans API
      if (sessionData.xBc) {
        requestHeaders['x-bc'] = sessionData.xBc;
      }
      
      // 2. User-Agent (на всякий случай, хотя уже установлен через setUserAgent)
      if (sessionData.userAgent && !requestHeaders['User-Agent']) {
        requestHeaders['User-Agent'] = sessionData.userAgent;
      }
      
      // 3. Дополнительные headers для OnlyFans API (особенно для /api2/* endpoints)
      if (details.url.includes('/api')) {
        if (!requestHeaders['Referer']) {
          requestHeaders['Referer'] = 'https://onlyfans.com/';
        }
        if (!requestHeaders['Origin']) {
          requestHeaders['Origin'] = 'https://onlyfans.com';
        }
        if (!requestHeaders['Accept']) {
          requestHeaders['Accept'] = 'application/json, text/plain, */*';
        }
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
    console.log('✅ webRequest interceptor установлен (x-bc, User-Agent, API headers)');
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

  // Установить cookies перед загрузкой
  try {
    console.log('🍪 Устанавливаем cookies...');
    await setOnlyFansCookies(sessionData);
    console.log('✅ Cookies установлены, загружаем OnlyFans...');
    
    // Создаём promise для отслеживания загрузки с таймаутом
    let loadFinished = false;
    let localStorageSet = false; // Флаг для отслеживания установки localStorage
    
    // Обработчики событий загрузки (устанавливаем ДО loadURL)
    onlyFansView.webContents.on('did-finish-load', async () => {
      // ========== ВАЖНО! Не используем loadFinished guard чтобы overlay переустанавливался ==========
      
      // Первая загрузка - устанавливаем localStorage и перезагружаем
      if (!localStorageSet) {
        console.log('✅ OnlyFans загружен (первый раз) - устанавливаем localStorage...');
        localStorageSet = true;
        
        // ========== КРИТИЧНО! Установить x-bc и другие данные в localStorage ==========
        try {
          const localStorageScript = `
            (function() {
              console.log('🔧 [DESKTOP] Устанавливаем localStorage для OnlyFans...');
              ${sessionData.xBc ? `localStorage.setItem('x-bc', '${sessionData.xBc}');
              console.log('✅ [DESKTOP] x-bc установлен:', '${sessionData.xBc}');` : ''}
              ${sessionData.platformUserId ? `localStorage.setItem('platformUserId', '${sessionData.platformUserId}');
              console.log('✅ [DESKTOP] platformUserId установлен');` : ''}
              ${sessionData.userId ? `localStorage.setItem('userId', '${sessionData.userId}');
              console.log('✅ [DESKTOP] userId установлен');` : ''}
              console.log('🎯 [DESKTOP] localStorage настроен!');
              return true;
            })();
          `;
          
          const result = await onlyFansView.webContents.executeJavaScript(localStorageScript);
          console.log('✅ localStorage установлен, результат:', result);
          
          // ПРОВЕРЯЕМ что localStorage действительно установлен
          const verifyScript = `
            (function() {
              const xBc = localStorage.getItem('x-bc');
              const userId = localStorage.getItem('userId');
              const platformUserId = localStorage.getItem('platformUserId');
              console.log('🔍 VERIFICATION - localStorage:');
              console.log('  x-bc:', xBc ? xBc.substring(0, 20) + '...' : 'ОТСУТСТВУЕТ');
              console.log('  userId:', userId || 'ОТСУТСТВУЕТ');
              console.log('  platformUserId:', platformUserId || 'ОТСУТСТВУЕТ');
              return { xBc: !!xBc, userId: !!userId, platformUserId: !!platformUserId };
            })();
          `;
          const verification = await onlyFansView.webContents.executeJavaScript(verifyScript);
          console.log('🔍 VERIFICATION результат:', verification);
          
          // После установки localStorage - перезагружаем страницу чтобы OnlyFans использовал новые данные
          console.log('🔄 Перезагружаем OnlyFans для применения localStorage...');
          await onlyFansView.webContents.reload();
          
        } catch (error) {
          console.error('❌ Ошибка установки localStorage:', error);
          // Продолжаем даже если ошибка
          loadFinished = true;
          mainWindow.addBrowserView(onlyFansView);
          const bounds = mainWindow.getContentBounds();
          onlyFansView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
          mainWindow.webContents.send('onlyfans-loaded');
        }
        return; // Выходим и ждём второй загрузки
      }
      
      // Вторая загрузка (после reload) - показываем BrowserView и внедряем overlay
      if (!loadFinished) {
        loadFinished = true;
        console.log('✅ OnlyFans перезагружен с localStorage - показываем BrowserView первый раз');
      
        // ТЕПЕРЬ добавляем BrowserView и устанавливаем размеры (только при первой загрузке)
        mainWindow.addBrowserView(onlyFansView);
        const bounds = mainWindow.getContentBounds();
        onlyFansView.setBounds({ 
          x: 0, 
          y: 0, 
          width: bounds.width, 
          height: bounds.height 
        });
        
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

    onlyFansView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      if (loadFinished) return;
      loadFinished = true;
      console.error('❌ Ошибка загрузки OnlyFans:', errorCode, errorDescription);
      mainWindow.webContents.send('onlyfans-error', errorDescription);
      
      // Очистка при ошибке
      if (onlyFansView) {
        mainWindow.removeBrowserView(onlyFansView);
        onlyFansView.webContents.destroy();
        onlyFansView = null;
      }
    });

    // Начинаем загрузку (BrowserView ещё не показан)
    // ВАЖНО: Загружаем ЗАЩИЩЁННУЮ страницу (профиль) вместо главной, чтобы сразу проверить аутентификацию
    console.log('🌐 Загружаем https://onlyfans.com/my/profile ...');
    await onlyFansView.webContents.loadURL('https://onlyfans.com/my/profile');
    
    // Таймаут 30 секунд на загрузку
    setTimeout(() => {
      if (!loadFinished && onlyFansView) {
        loadFinished = true;
        console.error('⏱️ Таймаут загрузки OnlyFans (30 секунд)');
        mainWindow.webContents.send('onlyfans-error', 'Таймаут загрузки (30 сек)');
        
        // Очистка
        if (onlyFansView) {
          mainWindow.removeBrowserView(onlyFansView);
          onlyFansView.webContents.destroy();
          onlyFansView = null;
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
function closeOnlyFansView() {
  if (onlyFansView) {
    mainWindow.removeBrowserView(onlyFansView);
    onlyFansView.webContents.destroy();
    onlyFansView = null;
    console.log('✅ OnlyFans view закрыт');
    // Notify renderer that view is closed
    mainWindow.webContents.send('onlyfans-closed');
  }
}

// Установить cookies для OnlyFans
async function setOnlyFansCookies(sessionData) {
  const partitionName = `persist:onlyfans-${sessionData.id}`;
  const ses = session.fromPartition(partitionName);
  
  // Очистить ВСЕ данные partition перед установкой новых cookies
  try {
    await ses.clearStorageData();
    console.log('🧹 Partition полностью очищен');
  } catch (error) {
    console.warn('⚠️ Не удалось очистить partition:', error);
  }
  
  // ========== ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ ==========
  console.log('📋 RAW COOKIE STRING:', sessionData.cookie);
  console.log('📏 Cookie length:', sessionData.cookie.length);
  
  // Парсим cookie string (БЕЗ пробела после точки с запятой!)
  const cookieStrings = sessionData.cookie.split(';').filter(s => s.trim().length > 0);
  
  console.log('🔢 Parsed cookies count:', cookieStrings.length);
  console.log('📝 Parsed cookies:', cookieStrings);
  
  // If no cookies to set, return early
  if (cookieStrings.length === 0) {
    console.log('⚠️ No cookies to set (empty cookie string)');
    return;
  }
  
  const cookiePromises = [];
  let successCount = 0;
  let failCount = 0;

  for (const cookieStr of cookieStrings) {
    const [name, ...valueParts] = cookieStr.split('=');
    const value = valueParts.join('=');

    if (!name || !value) {
      console.warn('⚠️ Skipping invalid cookie:', cookieStr);
      continue;
    }

    // ВАЖНО: Устанавливаем cookie БЕЗ domain (пусть браузер сам определит)
    // Это более надёжно чем указывать .onlyfans.com или onlyfans.com
    const cookieDetails = {
      url: 'https://onlyfans.com',
      name: name.trim(),
      value: value.trim(),
      // domain: '.onlyfans.com', // НЕ указываем domain - пусть браузер определит
      path: '/',
      secure: true,
      httpOnly: false, // ВАЖНО: OnlyFans читает cookies из JavaScript
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    };

    console.log(`🍪 Setting cookie: ${name.trim()} = ${value.trim().substring(0, 20)}...`);

    cookiePromises.push(
      ses.cookies.set(cookieDetails)
        .then(() => {
          console.log('✅ Set cookie:', name.trim());
          successCount++;
          return true;
        })
        .catch(error => {
          console.error('❌ Error setting cookie:', name.trim(), error.message);
          failCount++;
          return null;
        })
    );
  }

  await Promise.all(cookiePromises);
  
  console.log(`✅ Cookies установлено: ${successCount}, ошибок: ${failCount}`);
  
  // Проверяем что cookies действительно установлены
  const installedCookies = await ses.cookies.get({ url: 'https://onlyfans.com' });
  console.log('🔍 VERIFICATION - Cookies в partition:', installedCookies.length);
  installedCookies.forEach(c => {
    console.log(`   ✓ ${c.name} = ${c.value.substring(0, 20)}...`);
  });
  
  // If too many failures, clear partition and throw
  if (failCount > cookieStrings.length / 2) {
    console.error('❌ Слишком много ошибок при установке cookies, очищаем partition');
    await ses.clearStorageData();
    throw new Error(`Failed to set ${failCount} out of ${cookieStrings.length} cookies`);
  }
}

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
