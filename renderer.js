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

async function getBookmarkDisplayName(bookmarkFolder, name) {
  const filePath = path.join(bookmarkFolder, `${name}.bookmark.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.displayName || name;
  } catch (e) {
    console.warn(`Could not load ${filePath}`, e);
    return name; // fallback to raw name
  }
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
    if (!bookmarksFile) {
      list.textContent = 'bookmarks.json not found';
      return;
    }

    try {
      const content = await fs.readFile(bookmarksFile, 'utf-8');
      const data = JSON.parse(content);
      const items = Array.isArray(data.items) ? data.items : [];

      for (const item of items) {
        if (item.children && item.displayName) {
          // Group with children
          const container = document.createElement('div');
          container.className = 'bookmark-item parent';

          const label = document.createElement('span');
          label.textContent = item.displayName;

          const icon = document.createElement('span');
          icon.className = 'toggle-icon';
          icon.textContent = '▼';

          const childrenBox = document.createElement('div');
          childrenBox.className = 'children-container';

          for (const childName of item.children) {
            const displayName = await getBookmarkDisplayName(path.dirname(bookmarksFile), childName);
            const childDiv = document.createElement('div');
            childDiv.className = 'child-item';
            childDiv.textContent = displayName;
            childrenBox.appendChild(childDiv);
          }   

          container.appendChild(label);
          container.appendChild(icon);
          list.appendChild(container);
          list.appendChild(childrenBox);

          // Expand/collapse logic
          container.addEventListener('click', () => {
            const isHidden = childrenBox.classList.toggle('hidden');
            icon.textContent = isHidden ? '▼' : '▲';
          });

        } else {
          // Plain bookmark
            const bookmarkDiv = document.createElement('div');
            bookmarkDiv.className = 'bookmark-item';
            const displayName = await getBookmarkDisplayName(path.dirname(bookmarksFile), item.name);
            bookmarkDiv.textContent = displayName;
            list.appendChild(bookmarkDiv);

        }
      }

    } catch (e) {
      console.error('Failed to read bookmarks.json:', e);
      list.textContent = 'Failed to load bookmarks';
    }
  });
});
