window.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('bookmark-input');
    const list = document.getElementById('bookmark-list');
    const addBtn = document.getElementById('add-btn');

    addBtn.addEventListener('click', () => {
        const url = input.value.trim();
        if (url) {
            const li = document.createElement('li');
            li.textContent = url;
            list.appendChild(li);
            input.value = '';
        }
    });

    console.log('Renderer loaded');
});
