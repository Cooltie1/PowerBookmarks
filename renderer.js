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
                } catch (e) {}
            }
            const result = await findBookmarksJson(fullPath);
            if (result) return result;
        }
    }
    return null;
}

async function readBookmarkNames(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        const list = Array.isArray(data.bookmarks) ? data.bookmarks : [];
        return list.map(b => b.displayName || b.name).filter(Boolean);
    } catch (e) {
        console.error('Failed to read bookmarks:', e);
        return [];
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const chooseBtn = document.getElementById('choose-folder');
    const selected = document.getElementById('selected-folder');
    const listEl = document.getElementById('bookmark-list');

    chooseBtn.addEventListener('click', async () => {
        const folderPath = await ipcRenderer.invoke('select-folder');
        listEl.innerHTML = '';
        selected.textContent = '';

        if (folderPath) {
            const bookmarksFile = await findBookmarksJson(folderPath);

            if (bookmarksFile) {
                selected.textContent = bookmarksFile;
                const names = await readBookmarkNames(bookmarksFile);
                names.forEach(name => {
                    const li = document.createElement('li');
                    li.textContent = name;
                    listEl.appendChild(li);
                });
            } else {
                selected.textContent = 'Bookmarks file not found';
            }
        }
    });

    console.log('Renderer loaded');
});
