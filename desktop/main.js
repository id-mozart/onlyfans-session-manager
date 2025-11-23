const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');

// Server URL - можно настроить через env или конфиг
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';

let mainWindow;
let onlyFansView;

// Создать главное окно
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'OnlyFans Session Manager',
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
      webSecurity: true, // Оставляем защиту включенной
      partition: partitionName
    }
  });

  mainWindow.addBrowserView(onlyFansView);

  // Установить размеры (занимает всё окно) - используем content bounds
  const bounds = mainWindow.getContentBounds();
  onlyFansView.setBounds({ 
    x: 0, 
    y: 0, 
    width: bounds.width, 
    height: bounds.height 
  });

  // Установить cookies перед загрузкой
  try {
    await setOnlyFansCookies(sessionData);
    console.log('✅ Cookies установлены, загружаем OnlyFans...');
    await onlyFansView.webContents.loadURL('https://onlyfans.com');
  } catch (error) {
    console.error('❌ Ошибка установки cookies или загрузки:', error);
    mainWindow.webContents.send('onlyfans-error', error.message);
    // Удалить view при ошибке
    if (onlyFansView) {
      mainWindow.removeBrowserView(onlyFansView);
      onlyFansView.webContents.destroy();
      onlyFansView = null;
    }
    throw error; // Re-throw to surface in IPC handler
  }

  // Логирование для отладки
  onlyFansView.webContents.on('did-finish-load', () => {
    console.log('✅ OnlyFans загружен');
    mainWindow.webContents.send('onlyfans-loaded');
  });

  onlyFansView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('❌ Ошибка загрузки OnlyFans:', errorCode, errorDescription);
    mainWindow.webContents.send('onlyfans-error', errorDescription);
  });

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
  
  // Парсим cookie string
  const cookieStrings = sessionData.cookie.split('; ').filter(s => s.trim().length > 0);
  
  // If no cookies to set, return early
  if (cookieStrings.length === 0) {
    console.log('⚠️ No cookies to set (empty cookie string)');
    return;
  }
  
  const cookiePromises = [];
  let successCount = 0;
  let failCount = 0;

  for (const cookieStr of cookieStrings) {
    const [nameValue] = cookieStr.split(';');
    const [name, ...valueParts] = nameValue.split('=');
    const value = valueParts.join('=');

    if (!name || !value) continue;

    const cookieDetails = {
      url: 'https://onlyfans.com',
      name: name.trim(),
      value: value.trim(),
      domain: '.onlyfans.com',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
    };

    cookiePromises.push(
      ses.cookies.set(cookieDetails)
        .then(cookie => {
          if (cookie) {
            console.log('✅ Set cookie:', name);
            successCount++;
          } else {
            console.warn('⚠️ Failed to set cookie:', name);
            failCount++;
          }
          return cookie;
        })
        .catch(error => {
          console.error('❌ Error setting cookie:', name, error);
          failCount++;
          // Don't throw - continue with other cookies
          return null;
        })
    );
  }

  await Promise.all(cookiePromises);
  
  console.log(`✅ Cookies установлено: ${successCount}, ошибок: ${failCount}`);
  
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
