const fs = require('fs').promises;
const path = require('path');
const { ipcRenderer } = require('electron');

let activeVisualEl = null;
let visualColumn = null;
let visualDetailsEl = null;
let tooltipEl = null;
const visualInfoMap = new WeakMap();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseField(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // Prefer queryRef for display, fall back to nativeQueryRef
  const name = typeof obj.nativeQueryRef === 'string' ? obj.nativeQueryRef : obj.queryRef;
  if (typeof name !== 'string') return null;

  let entity;
  let property;
  let fieldType;
  let level;
  if (obj.field?.Column) {
    fieldType = 'Column';
    entity = obj.field.Column.Expression?.SourceRef?.Entity;
    property = obj.field.Column.Property;
  } else if (obj.field?.Measure) {
    fieldType = 'Measure';
    entity = obj.field.Measure.Expression?.SourceRef?.Entity;
    property = obj.field.Measure.Property;
  } else if (obj.field?.Hierarchy) {
    fieldType = 'Hierarchy';
    entity = obj.field.Hierarchy.Expression?.SourceRef?.Entity;
    property = obj.field.Hierarchy.Hierarchy;
  }

  // Fallback for Aggregation -> Column pattern (implicit measures)
  if (!entity && !property && obj.field?.Aggregation?.Expression?.Column) {
    fieldType = 'Implicit Measure';
    entity =
      obj.field.Aggregation.Expression.Column.Expression?.SourceRef?.Entity;
    property = obj.field.Aggregation.Expression.Column.Property;
  }

  // Fallback for HierarchyLevel pattern
  if (!entity && !property && obj.field?.HierarchyLevel) {
    fieldType = 'Hierarchy Level';
    entity =
      obj.field.HierarchyLevel.Expression?.Hierarchy?.Expression?.SourceRef?.Entity;
    property = obj.field.HierarchyLevel.Expression?.Hierarchy?.Hierarchy;
    level = obj.field.HierarchyLevel.Level;
  }

  const label = obj.label || property;
  const tooltipParts = [];
  if (entity) tooltipParts.push(entity);
  if (label) tooltipParts.push(label);
  const tooltip = tooltipParts.join('.') || name;

  return { name, tooltip, entity, property, fieldType, level };
}

function collectFields(obj, map) {
  if (!obj || typeof obj !== 'object') return;

  const info = parseField(obj);
  if (info && !map.has(info.name)) {
    map.set(info.name, info);
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      let arr = value;
      const hasActive = arr.some(v => v && v.active !== false);
      if (hasActive) arr = arr.filter(v => !v || v.active !== false);
      for (const v of arr) collectFields(v, map);
    } else if (value && typeof value === 'object') {
      collectFields(value, map);
    }
  }
}

function collectFieldsByBucket(data) {
  const result = {};
  const queryState =
    data?.visual?.query?.queryState || data?.singleVisual?.query?.queryState;
  if (!queryState || typeof queryState !== 'object') return result;

  for (const [bucket, obj] of Object.entries(queryState)) {
    const map = new Map();
    let projections = Array.isArray(obj?.projections) ? obj.projections : [];
    const hasActive = projections.some(p => p && p.active !== false);
    if (hasActive) projections = projections.filter(p => !p || p.active !== false);
    for (const proj of projections) {
      const info = parseField(proj);
      if (info && !map.has(info.name)) {
        map.set(info.name, info);
      }
    }
    if (map.size > 0) {
      const arr = Array.from(map.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      result[bucket] = arr;
    }
  }

  return result;
}

function showTooltip(e, data) {
  if (!tooltipEl) return;
  tooltipEl.innerHTML =
    `<strong>Entity:</strong> ${escapeHtml(data.entity || '')}<br>` +
    `<strong>Field:</strong> ${escapeHtml(data.field || '')}<br>` +
    `<strong>Field Type:</strong> ${escapeHtml(data.fieldType || '')}` +
    (data.level ? `<br><strong>Level:</strong> ${escapeHtml(data.level)}` : '');
  tooltipEl.style.display = 'block';
  moveTooltip(e);
}

function moveTooltip(e) {
  if (!tooltipEl) return;
  tooltipEl.style.left = e.pageX + 10 + 'px';
  tooltipEl.style.top = e.pageY + 10 + 'px';
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

function attachTooltipHandlers(container) {
  const items = container.querySelectorAll('li[data-entity]');
  items.forEach(item => {
    const data = {
      entity: item.getAttribute('data-entity'),
      field: item.getAttribute('data-field'),
      fieldType: item.getAttribute('data-field-type'),
      level: item.getAttribute('data-level'),
    };
    item.addEventListener('mouseenter', e => showTooltip(e, data));
    item.addEventListener('mousemove', moveTooltip);
    item.addEventListener('mouseleave', hideTooltip);
  });
}

function setActiveVisual(el) {
  hideTooltip();
  if (activeVisualEl) {
    activeVisualEl.classList.remove('active');
  }
  activeVisualEl = el;
  if (activeVisualEl) {
    activeVisualEl.classList.add('active');
    if (visualColumn && visualDetailsEl) {
      visualColumn.style.display = 'flex';
      const info = visualInfoMap.get(activeVisualEl);
      if (info) {
        const type =
          info.data?.visual?.visualType ||
          info.data?.singleVisual?.visualType ||
          'Unknown';

        const buckets = collectFieldsByBucket(info.data);
        let fieldsHtml = '';

        if (Object.keys(buckets).length > 0) {
          const bucketItems = Object.entries(buckets)
            .map(([bucket, fields]) => {
              const list = fields
                .map(f =>
                  `<li data-entity="${escapeHtml(f.entity || '')}" data-field="${escapeHtml(f.property || '')}" data-field-type="${escapeHtml(f.fieldType || '')}" data-level="${escapeHtml(f.level || '')}">${escapeHtml(f.name)}</li>`
                )
                .join('');
              return `<li><strong>${bucket}:</strong> <ul>${list}</ul></li>`;
            })
            .join('');
          fieldsHtml = `<ul>${bucketItems}</ul>`;
        } else {
          const fieldMap = new Map();
          collectFields(info.data, fieldMap);
          const fields = Array.from(fieldMap.values())
            .sort((a, b) => a.name.localeCompare(b.name));
          fieldsHtml = fields.length
            ? `<ul>${fields
                .map(f =>
                  `<li data-entity="${escapeHtml(f.entity || '')}" data-field="${escapeHtml(f.property || '')}" data-field-type="${escapeHtml(f.fieldType || '')}" data-level="${escapeHtml(f.level || '')}">${escapeHtml(f.name)}</li>`
                )
                .join('')}</ul>`
            : 'None';
        }

        visualDetailsEl.innerHTML =
          `<strong>Type:</strong> ${type}<br>` +
          `<strong>Fields:</strong> ${fieldsHtml}`;
        attachTooltipHandlers(visualDetailsEl);
      } else {
        visualDetailsEl.textContent = '';
      }
    }
  }
  if (!activeVisualEl && visualColumn && visualDetailsEl) {
    visualColumn.style.display = 'none';
    visualDetailsEl.textContent = '';
  }
}

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

async function getBookmarkInfo(bookmarkFolder, name) {
  const filePath = path.join(bookmarkFolder, `${name}.bookmark.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const displayName = data.displayName || name;
    const pageId = data.explorationState?.activeSection;
    let pageName = 'Unknown';

    if (pageId) {
      const definitionFolder = path.dirname(bookmarkFolder);
      const pageFolder = path.join(definitionFolder, 'pages', pageId);
      try {
        const pageContent = await fs.readFile(path.join(pageFolder, 'page.json'), 'utf-8');
        const pageData = JSON.parse(pageContent);
        pageName = pageData.displayName || pageId;
      } catch {
        pageName = pageId;
      }
    }

    return { name, displayName, pageId, pageName };
  } catch {
    return { name, displayName: name, pageId: null, pageName: 'Unknown' };
  }
}

async function showBookmarkDetails(metaContainer, container, bookmarkFolder, bookmarkName) {
  const filePath = path.join(bookmarkFolder, `${bookmarkName}.bookmark.json`);
  try {
    setActiveVisual(null);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const sectionId = data.explorationState?.activeSection;
    let sectionName = 'Unknown';

    const applyOnly = !!data.options?.applyOnlyToTargetVisuals;
    const suppress = !!data.options?.suppressActiveSection;
    const suppressData = !!data.options?.suppressData;
    const suppressDisplay = !!data.options?.suppressDisplay;
    const targetNames = new Set(
      Array.isArray(data.options?.targetVisualNames)
        ? data.options.targetVisualNames
        : []
    );

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


            // Pull the display name from two possible locations
            // 1. Parent visuals store it under visualGroup.displayName
            // 2. Child visuals use the title text under visual.visualContainerObjects

            const groupName = visualData?.visualGroup?.displayName;

            const titleObject = visualData?.visual?.visualContainerObjects?.title?.[0];
            const titleExpr = titleObject?.properties?.text?.expr?.Literal?.Value;
            const titleName = titleExpr?.replace(/^'(.*)'$/, '$1');

            const displayName = groupName || titleName;

            console.log('titleObject:', titleObject);
            console.log('titleExpr:', titleExpr);

            console.log(displayName); // should output: Title on visual but not turned on

              visualMap.set(folderName, {
                id: folderName,
                name: displayName || visualData.name || folderName,
                parent: visualData.parentGroupName || null,
                children: [],
                data: visualData
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

        function renderVisualItem(visual, parentEl, depth = 0) {
          const visualDiv = document.createElement('div');
          visualDiv.className = 'bookmark-item visual-item';
          visualDiv.style.marginLeft = `${depth * 20}px`;
          visualInfoMap.set(visualDiv, visual);

          if (applyOnly && targetNames.has(visual.id)) {
            visualDiv.classList.add('target-visual');
          }

          const label = document.createElement('span');
          label.textContent = visual.name;
          visualDiv.appendChild(label);

          parentEl.appendChild(visualDiv);

          if (visual.children.length > 0) {
            const icon = document.createElement('span');
            icon.className = 'toggle-icon';
            icon.textContent = '▼';
            visualDiv.appendChild(icon);

            const childContainer = document.createElement('div');
            childContainer.className = 'children-container hidden';

            visualDiv.addEventListener('click', (e) => {
              e.stopPropagation();
              if (activeVisualEl === visualDiv) {
                setActiveVisual(null);
              } else {
                setActiveVisual(visualDiv);
              }
              const hidden = childContainer.classList.toggle('hidden');
              icon.textContent = hidden ? '▼' : '▲';
            });

            for (const child of visual.children) {
              renderVisualItem(child, childContainer, depth + 1);
            }

            parentEl.appendChild(childContainer);
          } else {
            visualDiv.addEventListener('click', (e) => {
              e.stopPropagation();
              if (activeVisualEl === visualDiv) {
                setActiveVisual(null);
              } else {
                setActiveVisual(visualDiv);
              }
            });
          }

          return visualDiv;
        }

        for (const root of roots) {
          renderVisualItem(root, visualContainer, 0);
        }

        metaContainer.innerHTML =
          `<strong>Page:</strong> ${sectionName}<br>` +
          `<strong>Selected Visuals:</strong> ${applyOnly}<br>` +
          `<strong>Current Page:</strong> ${suppress}<br>` +
          `<strong>Data:</strong> ${suppressData}<br>` +
          `<strong>Display:</strong> ${suppressDisplay}`;

        container.innerHTML = '';
        container.appendChild(visualContainer);

      } catch (e) {
        console.warn(`Failed to read visuals folder:`, e.message);
        metaContainer.innerHTML =
          `<strong>Page:</strong> ${sectionName}<br>` +
          `<strong>Selected Visuals:</strong> ${applyOnly}<br>` +
          `<strong>Current Page:</strong> ${suppress}<br>` +
          `<strong>Data:</strong> ${suppressData}<br>` +
          `<strong>Display:</strong> ${suppressDisplay}`;
        container.innerHTML = `<em>Could not load visuals</em>`;
      }
    } else {
      metaContainer.innerHTML =
        `<strong>Page:</strong> Unknown<br>` +
        `<strong>Selected Visuals:</strong> ${applyOnly}<br>` +
        `<strong>Current Page:</strong> ${suppress}<br>` +
        `<strong>Data:</strong> ${suppressData}<br>` +
        `<strong>Display:</strong> ${suppressDisplay}`;
      container.innerHTML = `<em>No active section found</em>`;
    }
  } catch (e) {
    metaContainer.innerHTML = '';
    container.innerHTML = `<em>Could not load details for bookmark "${bookmarkName}"</em>`;
    console.warn(`Failed to load bookmark ${bookmarkName}:`, e.message);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const chooseBtn = document.getElementById('choose-folder');
  const selected = document.getElementById('selected-folder');
  const list = document.getElementById('bookmark-list');
  const detailEl = document.getElementById('bookmark-details');
  const metaEl = document.getElementById('bookmark-meta');
  visualColumn = document.getElementById('visual-column');
  visualDetailsEl = document.getElementById('visual-details');
  tooltipEl = document.getElementById('tooltip');
  const bookmarkColumn = document.getElementById('bookmark-column');
  const bookmarkResizer = document.getElementById('bookmark-resizer');
  const toggleAllBtn = document.getElementById('toggle-all');
  const toggleVisualsBtn = document.getElementById('toggle-visuals');
  let activeBookmarkEl = null;
  let allCollapsed = true;
  let visualsCollapsed = true;

  function setAllCollapsed(collapsed) {
    const containers = document.querySelectorAll('#bookmark-list .children-container');
    containers.forEach(container => {
      let shouldCollapse = collapsed;
      if (collapsed && activeBookmarkEl && container.contains(activeBookmarkEl)) {
        shouldCollapse = false;
      }

      if (shouldCollapse) {
        container.classList.add('hidden');
      } else {
        container.classList.remove('hidden');
      }
      const icon = container.previousElementSibling?.querySelector('.toggle-icon');
      if (icon) {
        icon.textContent = shouldCollapse ? '▼' : '▲';
      }
    });
    toggleAllBtn.textContent = collapsed ? 'Expand All' : 'Collapse All';
  }

  function setVisualsCollapsed(collapsed) {
    const containers = document.querySelectorAll('#bookmark-details .children-container');
    containers.forEach(container => {
      if (collapsed) {
        container.classList.add('hidden');
      } else {
        container.classList.remove('hidden');
      }
      const icon = container.previousElementSibling?.querySelector('.toggle-icon');
      if (icon) {
        icon.textContent = collapsed ? '▼' : '▲';
      }
    });
    toggleVisualsBtn.textContent = collapsed ? 'Expand All' : 'Collapse All';
  }

  // Initialize UI in collapsed state
  setAllCollapsed(allCollapsed);
  setVisualsCollapsed(visualsCollapsed);

  toggleAllBtn.addEventListener('click', () => {
    allCollapsed = !allCollapsed;
    setAllCollapsed(allCollapsed);
  });

  toggleVisualsBtn.addEventListener('click', () => {
    visualsCollapsed = !visualsCollapsed;
    setVisualsCollapsed(visualsCollapsed);
  });

  let resizing = false;
  bookmarkResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizing = true;
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const rect = bookmarkColumn.getBoundingClientRect();
    const newWidth = e.clientX - rect.left;
    bookmarkColumn.style.width = Math.min(Math.max(newWidth, 150), 600) + 'px';
  });

  window.addEventListener('mouseup', () => {
    resizing = false;
  });

  function setActive(el) {
    if (activeBookmarkEl) {
      activeBookmarkEl.classList.remove('active');
    }
    activeBookmarkEl = el;
    if (activeBookmarkEl) {
      activeBookmarkEl.classList.add('active');
    }
  }

  async function loadProject(folderPath) {
    list.innerHTML = '';
    detailEl.innerHTML = '';
    metaEl.innerHTML = '';
    toggleVisualsBtn.style.display = 'none';
    visualsCollapsed = true;
    selected.textContent = path.basename(folderPath);
    setActive(null);
    chooseBtn.textContent = 'Change Project';

    // Show the expand/collapse button now that a project is loaded
    toggleAllBtn.style.display = 'inline-block';

    // Reset collapsed state for the new project
    allCollapsed = true;
    setAllCollapsed(allCollapsed);

    const bookmarksFile = await findBookmarksJson(folderPath);
    if (!bookmarksFile) {
      list.textContent = 'bookmarks.json not found';
      return;
    }

    try {
      const content = await fs.readFile(bookmarksFile, 'utf-8');
      const data = JSON.parse(content);
      const items = Array.isArray(data.items) ? data.items : [];
      const bookmarkFolder = path.dirname(bookmarksFile);
      const pages = new Map();

      for (const item of items) {
        if (item.children && item.displayName) {
          for (const childName of item.children) {
            const info = await getBookmarkInfo(bookmarkFolder, childName);
            const key = info.pageName;
            if (!pages.has(key)) {
              pages.set(key, { groups: new Map(), ungrouped: [] });
            }
            const pageEntry = pages.get(key);
            if (!pageEntry.groups.has(item.displayName)) {
              pageEntry.groups.set(item.displayName, []);
            }
            pageEntry.groups.get(item.displayName).push(info);
          }
        } else {
          const info = await getBookmarkInfo(bookmarkFolder, item.name);
          const key = info.pageName;
          if (!pages.has(key)) {
            pages.set(key, { groups: new Map(), ungrouped: [] });
          }
          pages.get(key).ungrouped.push(info);
        }
      }

      for (const [pageName, pageData] of pages.entries()) {
        const pageContainer = document.createElement('div');
        pageContainer.className = 'bookmark-item parent';

        const pageLabel = document.createElement('span');
        pageLabel.textContent = `\uD83D\uDCC4 ${pageName}`; // 📄 icon

        const pageIcon = document.createElement('span');
        pageIcon.className = 'toggle-icon';
        pageIcon.textContent = '▼';

        const pageChildrenBox = document.createElement('div');
        pageChildrenBox.className = 'children-container hidden';

        for (const [groupName, bookmarks] of pageData.groups.entries()) {
          const groupContainer = document.createElement('div');
          groupContainer.className = 'bookmark-item parent';

          const groupLabel = document.createElement('span');
          groupLabel.textContent = `\uD83D\uDCC2 ${groupName}`; // 🗂 icon

          const groupIcon = document.createElement('span');
          groupIcon.className = 'toggle-icon';
          groupIcon.textContent = '▼';

          const groupChildrenBox = document.createElement('div');
          groupChildrenBox.className = 'children-container hidden';

          for (const info of bookmarks) {
            const childDiv = document.createElement('div');
            childDiv.className = 'child-item';
            childDiv.textContent = `\uD83D\uDD16 ${info.displayName}`; // 🔖 icon
            childDiv.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (activeBookmarkEl === childDiv) {
                setActive(null);
                metaEl.innerHTML = '';
                detailEl.innerHTML = '';
                toggleVisualsBtn.style.display = 'none';
                return;
              }
              setActive(childDiv);
              await showBookmarkDetails(metaEl, detailEl, bookmarkFolder, info.name);
              visualsCollapsed = true;
              setVisualsCollapsed(visualsCollapsed);
              toggleVisualsBtn.style.display = 'inline-block';
            });
            groupChildrenBox.appendChild(childDiv);
          }

          groupContainer.appendChild(groupLabel);
          groupContainer.appendChild(groupIcon);
          pageChildrenBox.appendChild(groupContainer);
          pageChildrenBox.appendChild(groupChildrenBox);

          groupContainer.addEventListener('click', () => {
            const isActiveInside = activeBookmarkEl && groupChildrenBox.contains(activeBookmarkEl);
            const currentlyHidden = groupChildrenBox.classList.contains('hidden');
            if (isActiveInside && !currentlyHidden) return;
            const hidden = groupChildrenBox.classList.toggle('hidden');
            groupIcon.textContent = hidden ? '▼' : '▲';
          });
        }

        for (const info of pageData.ungrouped) {
          const bookmarkDiv = document.createElement('div');
          bookmarkDiv.className = 'bookmark-item';
          bookmarkDiv.textContent = `\uD83D\uDD16 ${info.displayName}`; // 🔖 icon
          bookmarkDiv.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (activeBookmarkEl === bookmarkDiv) {
              setActive(null);
              metaEl.innerHTML = '';
              detailEl.innerHTML = '';
              toggleVisualsBtn.style.display = 'none';
              return;
            }
            setActive(bookmarkDiv);
            await showBookmarkDetails(metaEl, detailEl, bookmarkFolder, info.name);
            visualsCollapsed = true;
            setVisualsCollapsed(visualsCollapsed);
            toggleVisualsBtn.style.display = 'inline-block';
          });
          pageChildrenBox.appendChild(bookmarkDiv);
        }

        pageContainer.appendChild(pageLabel);
        pageContainer.appendChild(pageIcon);
        list.appendChild(pageContainer);
        list.appendChild(pageChildrenBox);

        pageContainer.addEventListener('click', () => {
          const isActiveInside = activeBookmarkEl && pageChildrenBox.contains(activeBookmarkEl);
          const currentlyHidden = pageChildrenBox.classList.contains('hidden');
          if (isActiveInside && !currentlyHidden) return;
          const hidden = pageChildrenBox.classList.toggle('hidden');
          pageIcon.textContent = hidden ? '▼' : '▲';
        });
      }

      // Apply global collapse state to new elements
      setAllCollapsed(allCollapsed);
    } catch (e) {
      console.error('Failed to read bookmarks.json:', e);
      list.textContent = 'Failed to load bookmarks';
    }
  }

  chooseBtn.addEventListener('click', async () => {
    const folderPath = await ipcRenderer.invoke('select-folder');
    if (!folderPath) return;
    localStorage.setItem('lastFolderPath', folderPath);
    await loadProject(folderPath);
  });

  (async () => {
    const last = localStorage.getItem('lastFolderPath');
    if (last) {
      try {
        await fs.access(last);
        await loadProject(last);
      } catch {}
    }
  })();
});
