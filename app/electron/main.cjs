const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isDev = Boolean(process.env.FOLIO_DEV_URL);
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 340,
    minHeight: 600,
    show: false,
    title: 'Folio',
    backgroundColor: '#f4f0e8',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, target) => {
    const current = mainWindow.webContents.getURL();
    if (target !== current) event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL(process.env.FOLIO_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.camios.folio');
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === 'media');
    });
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'media');
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    dialog.showErrorBox('Folio no pudo abrir', error instanceof Error ? error.message : String(error));
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('folio:save-file', async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    return { canceled: false, error: 'Solicitud no autorizada' };
  }
  try {
    const data = payload?.data;
    const suppliedName = typeof payload?.fileName === 'string' ? payload.fileName : 'Documento Folio.pdf';
    const fileName = path.basename(suppliedName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').slice(0, 180);
    const extension = path.extname(fileName).toLowerCase();
    const allowed = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.docx', '.xlsx']);
    if (!allowed.has(extension)) return { canceled: false, error: 'Tipo de archivo no permitido' };
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
      return { canceled: false, error: 'Los datos del archivo no son válidos' };
    }
    const buffer = Buffer.from(data instanceof ArrayBuffer ? data : data.buffer, data.byteOffset ?? 0, data.byteLength);
    if (buffer.byteLength > 512 * 1024 * 1024) return { canceled: false, error: 'El archivo supera el límite de 512 MB' };

    const filters = Array.isArray(payload?.filters)
      ? payload.filters.filter((filter) => typeof filter?.name === 'string' && Array.isArray(filter?.extensions)).slice(0, 4)
      : [];
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar documento de Folio',
      defaultPath: path.join(app.getPath('documents'), fileName),
      filters: filters.length ? filters : [{ name: extension.slice(1).toUpperCase(), extensions: [extension.slice(1)] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, buffer);
    return { canceled: false, path: result.filePath };
  } catch (error) {
    return { canceled: false, error: error instanceof Error ? error.message : String(error) };
  }
});
