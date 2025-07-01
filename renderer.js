const fs = require('fs').promises;
const path = require('path');
const { ipcRenderer } = require('electron');

async function findBookmarksJson(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.Report')) {
        const candidate = path.join(fullPath, 'definition', 'bookmarks', 'bookmarks.json');
        try {
          await fs.access(candidate);
          return candidate;
        } catch (e) {
          // ignore
        }
      }
      const result = await findBookmarksJson(fullPath);
      if (result) return result;
    }
  }
  return null;
}

window.addEventListener('DOMContentLoaded', () => {
  const chooseBtn = document.getElementById('choose-folder');
  const selected = document.getElementById('selected-folder');
  const list = document.getElementById('bookmark-list');

  chooseBtn.addEventListener('click', async () => {
    list.innerHTML = '';
    selected.textContent = '';

    const folderPath = await ipcRenderer.invoke('select-folder');
    if (!folderPath) return;

    selected.textContent = path.basename(folderPath);

    const bookmarksFile = await findBookmarksJson(folderPath);
    if (bookmarksFile) {
      try {
        const content = await fs.readFile(bookmarksFile, 'utf-8');
        const data = JSON.parse(content);
        const items = Array.isArray(data.items) ? data.items : [];

        items.forEach(item => {
          const li = document.createElement('li');
          if (item.children && item.displayName) {
            li.textContent = `Group: ${item.displayName}`;
          } else {
            li.textContent = `Bookmark: ${item.name}`;
          }
          list.appendChild(li);
        });

      } catch (e) {
        console.error('Failed to read bookmarks.json:', e);
        const li = document.createElement('li');
        li.textContent = 'Failed to load bookmarks';
        list.appendChild(li);
      }
    } else {
      const li = document.createElement('li');
      li.textContent = 'bookmarks.json not found';
      list.appendChild(li);
    }
  });
});
