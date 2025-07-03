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
        } catch {}
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
  } catch {
    return name;
  }
}

async function showBookmarkDetails(container, bookmarkFolder, bookmarkName) {
  const filePath = path.join(bookmarkFolder, `${bookmarkName}.bookmark.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const sectionId = data.explorationState?.activeSection;
    let sectionName = 'Unknown';

    if (sectionId) {
      const definitionFolder = path.dirname(bookmarkFolder);
      const pageFolder = path.join(definitionFolder, 'pages', sectionId);

      // Load page name
      try {
        const pageJsonPath = path.join(pageFolder, 'page.json');
        const pageContent = await fs.readFile(pageJsonPath, 'utf-8');
        const pageData = JSON.parse(pageContent);
        sectionName = pageData.displayName || sectionId;
      } catch {
        sectionName = sectionId;
      }

      // Load and group visuals
      const visualsFolder = path.join(pageFolder, 'visuals');
      try {
        const visualDirs = await fs.readdir(visualsFolder, { withFileTypes: true });
        const visualMap = new Map();

        // First pass: read all visual.json files
        for (const entry of visualDirs) {
          if (!entry.isDirectory()) continue;
          const folderName = entry.name;
          const visualPath = path.join(visualsFolder, folderName, 'visual.json');

          try {
            const content = await fs.readFile(visualPath, 'utf-8');
            const visualData = JSON.parse(content);
            visualMap.set(folderName, {
              id: folderName,
              name: visualData.name || folderName,
              parent: visualData.parentGroupName || null,
              children: []
            });
          } catch (e) {
            console.warn(`Failed to load visual: ${folderName}`, e.message);
          }
        }

        // Build hierarchy
        const roots = [];
        for (const visual of visualMap.values()) {
          if (visual.parent && visualMap.has(visual.parent)) {
            visualMap.get(visual.parent).children.push(visual);
          } else {
            roots.push(visual);
          }
        }

        // Debugging: print each visual and its children
        for (const [id, visual] of visualMap.entries()) {
          const childNames = visual.children.map(c => c.id).join(', ');
          console.log(`Visual ${id} children: ${childNames || 'none'}`);
        }

        const visualContainer = document.createElement('div');

        function renderVisualItem(visual, depth = 0) {
          const visualDiv = document.createElement('div');
          visualDiv.className = 'bookmark-item';
          visualDiv.style.marginLeft = `${depth * 20}px`;

          const label = document.createElement('span');
          label.textContent = visual.name;

          visualDiv.appendChild(label);

          if (visual.children.length > 0) {
            const icon = document.createElement('span');
            icon.className = 'toggle-icon';
            icon.textContent = '▼';
            visualDiv.appendChild(icon);

            const childContainer = document.createElement('div');
            childContainer.className = 'children-container';

            for (const child of visual.children) {
              childContainer.appendChild(renderVisualItem(child, depth + 1));
            }

            visualDiv.addEventListener('click', () => {
              const hidden = childContainer.classList.toggle('hidden');
              icon.textContent = hidden ? '▼' : '▲';
            });

            visualContainer.appendChild(visualDiv);
            visualContainer.appendChild(childContainer);
          } else {
            visualContainer.appendChild(visualDiv);
          }

          return visualDiv;
        }

        for (const root of roots) {
          renderVisualItem(root);
        }

        container.innerHTML = `<strong>Page:</strong> ${sectionName}<br><br><strong>Visuals (Grouped by parent):</strong><br>`;
        container.appendChild(visualContainer);

      } catch (e) {
        console.warn(`Failed to read visuals folder:`, e.message);
        container.innerHTML = `<strong>Page:</strong> ${sectionName}<br><br><em>Could not load visuals</em>`;
      }
    } else {
      container.innerHTML = `<strong>Page:</strong> Unknown<br><br><em>No active section found</em>`;
    }
  } catch (e) {
    container.innerHTML = `<em>Could not load details for bookmark "${bookmarkName}"</em>`;
    console.warn(`Failed to load bookmark ${bookmarkName}:`, e.message);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const chooseBtn = document.getElementById('choose-folder');
  const selected = document.getElementById('selected-folder');
  const list = document.getElementById('bookmark-list');
  const detailEl = document.getElementById('bookmark-details');

  chooseBtn.addEventListener('click', async () => {
    list.innerHTML = '';
    detailEl.innerHTML = '';
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

            childDiv.addEventListener('click', (e) => {
              e.stopPropagation(); // prevent toggle
              showBookmarkDetails(detailEl, path.dirname(bookmarksFile), childName);
            });

            childrenBox.appendChild(childDiv);
          }

          container.appendChild(label);
          container.appendChild(icon);
          list.appendChild(container);
          list.appendChild(childrenBox);

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

          bookmarkDiv.addEventListener('click', () => {
            showBookmarkDetails(detailEl, path.dirname(bookmarksFile), item.name);
          });
        }
      }
    } catch (e) {
      console.error('Failed to read bookmarks.json:', e);
      list.textContent = 'Failed to load bookmarks';
    }
  });
});
