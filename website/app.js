// Tab selection within mock-app
const tabButtons = document.querySelectorAll('.mock-svt-btn');
const panelContents = document.querySelectorAll('.mock-panel-content');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active state from all buttons
    tabButtons.forEach(b => b.classList.remove('active'));
    // Hide all panel content
    panelContents.forEach(p => p.classList.remove('active'));

    // Set active button
    btn.classList.add('active');
    // Show targeted panel
    const targetId = btn.getAttribute('data-target');
    const targetPanel = document.getElementById(targetId);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
  });
});

// Interactive counter button in preview mock
const countBtn = document.getElementById('demo-count-btn');
let clickCount = 0;
if (countBtn) {
  countBtn.addEventListener('click', () => {
    clickCount++;
    countBtn.textContent = `Clicks: ${clickCount}`;
    
    // Also update the CodeMirror mock code to make it feel extremely responsive!
    // Update Clicks count in the code mock to match.
    const codeLines = document.querySelectorAll('.editor-body .code-line');
    codeLines.forEach(line => {
      if (line.textContent.includes('Clicks:')) {
        const lnSpan = line.querySelector('.ln');
        const kwSpan = line.querySelector('.kw');
        
        // Construct new highlighted line
        line.innerHTML = `<span class="ln">10</span>  <span class="kw">&lt;button</span> <span class="attr">onclick</span>=<span class="str">&#123;increment&#125;</span><span class="kw">&gt;</span>Clicks: ${clickCount}<span class="kw">&lt;/button&gt;</span>`;
      }
    });
  });
}

// Copy Install Command helper
function copyInstallCommand() {
  const codeText = document.getElementById('install-cmd').innerText;
  navigator.clipboard.writeText(codeText).then(() => {
    const copyBtn = document.querySelector('.copy-btn');
    const originalSvg = copyBtn.innerHTML;
    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      copyBtn.innerHTML = originalSvg;
    }, 2000);
  });
}

// Platform detection for download link
window.addEventListener('DOMContentLoaded', () => {
  const detectEl = document.getElementById('platform-detect');
  const downloadBtn = document.getElementById('download-btn');
  const installCmd = document.getElementById('install-cmd');

  const userAgent = window.navigator.userAgent.toLowerCase();
  
  if (userAgent.indexOf('win') !== -1) {
    detectEl.textContent = 'Detected OS: Windows (x64) · .msi Installer';
    downloadBtn.textContent = 'Download for Windows';
    downloadBtn.href = 'https://github.com/Samuel00098/soryq/releases/latest/download/Soryq_x64-setup.exe';
    installCmd.textContent = 'winget install Samuel00098.Soryq';
  } else if (userAgent.indexOf('mac') !== -1) {
    detectEl.textContent = 'Detected OS: macOS · .dmg Disk Image';
    downloadBtn.textContent = 'Download for macOS';
    downloadBtn.href = 'https://github.com/Samuel00098/soryq/releases/latest/download/Soryq_aarch64.dmg';
    installCmd.textContent = 'brew install Samuel00098/soryq';
  } else if (userAgent.indexOf('linux') !== -1) {
    detectEl.textContent = 'Detected OS: Linux · .AppImage / .deb Package';
    downloadBtn.textContent = 'Download for Linux';
    downloadBtn.href = 'https://github.com/Samuel00098/soryq/releases/latest';
    installCmd.textContent = 'snap install soryq';
  } else {
    detectEl.textContent = 'Download Soryq from our latest releases';
    downloadBtn.textContent = 'View All Downloads';
    downloadBtn.href = 'https://github.com/Samuel00098/soryq/releases/latest';
  }
});
