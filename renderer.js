const fs = require('fs').promises;
const path = require('path');

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
    const folderInput = document.getElementById('folder-input');
    const chooseBtn = document.getElementById('choose-folder');
    const selected = document.getElementById('selected-folder');
    const listEl = document.getElementById('bookmark-list');

    chooseBtn.addEventListener('click', () => {
        folderInput.click();
    });

    folderInput.addEventListener('change', async () => {
        listEl.innerHTML = '';

        if (folderInput.files.length > 0) {
            const first = folderInput.files[0];
            const basePath = first.path.replace(first.webkitRelativePath, '');
            selected.textContent = path.basename(basePath);

            const bookmarksFile = await findBookmarksJson(basePath);
            if (bookmarksFile) {
                const names = await readBookmarkNames(bookmarksFile);
                names.forEach(name => {
                    const li = document.createElement('li');
                    li.textContent = name;
                    listEl.appendChild(li);
                });
            }
        } else {
            selected.textContent = '';
        }
    });

    console.log('Renderer loaded');
});
