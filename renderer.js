window.addEventListener('DOMContentLoaded', () => {
    const folderInput = document.getElementById('folder-input');
    const chooseBtn = document.getElementById('choose-folder');
    const selected = document.getElementById('selected-folder');

    chooseBtn.addEventListener('click', () => {
        folderInput.click();
    });

    folderInput.addEventListener('change', () => {
        if (folderInput.files.length > 0) {
            const path = folderInput.files[0].webkitRelativePath;
            const folderName = path.split('/')[0];
            selected.textContent = folderName;
        } else {
            selected.textContent = '';
        }
    });

    console.log('Renderer loaded');
});
