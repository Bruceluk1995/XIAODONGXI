// panel.js - 批量生成控制面板 (侧边抽屉版, Tab 版)
// 运行在 chrome-extension:// iframe 中，拥有完整的扩展 API 权限
(function () {
  const MAX_FILES = 30;
  let selectedFiles = [];

  // 清理文件名中的括号，避免干扰 (@xxx) mention 语法
  function sanitizeFileName(name) {
    return name.replace(/[()\uff08\uff09\[\]\u3010\u3011{}\uff5b\uff5d]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  // ============================================================
  // DOM 引用
  // ============================================================
  // --- 全局 ---
  const btnCollapse = document.getElementById('btnCollapse');
  const connStatus = document.getElementById('connStatus');

  // --- Tab 切换 ---
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const taskCountBadge = document.getElementById('taskCountBadge');

  // --- Tab 1: 接收任务 ---
  const logEl = document.getElementById('log');
  const btnClearLog = document.getElementById('btnClearLog');
  const taskDelayInput = document.getElementById('taskDelay');

  // --- Tab 2: 手动提交 ---
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const statusBar = document.getElementById('statusBar');
  const fileCount = document.getElementById('fileCount');
  const btnClear = document.getElementById('btnClear');
  const btnPreset = document.getElementById('btnPreset');
  const btnCheckPage = document.getElementById('btnCheckPage');
  const progressEl = document.getElementById('progress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const promptInput = document.getElementById('promptInput');
  const btnDoGenerate = document.getElementById('btnDoGenerate');
  const btnSubmitGenerate = document.getElementById('btnSubmitGenerate');

  // 预设编辑器
  const presetEditToggle = document.getElementById('presetEditToggle');
  const presetDisplay = document.getElementById('presetDisplay');
  const presetEditor = document.getElementById('presetEditor');
  const presetSave = document.getElementById('presetSave');
  const presetCancel = document.getElementById('presetCancel');
  const cfgModel = document.getElementById('cfgModel');
  const cfgRefMode = document.getElementById('cfgRefMode');
  const cfgRatio = document.getElementById('cfgRatio');
  const cfgDuration = document.getElementById('cfgDuration');

  // 预设标签
  const tagModel = document.getElementById('tagModel');
  const tagRefMode = document.getElementById('tagRefMode');
  const tagRatio = document.getElementById('tagRatio');
  const tagDuration = document.getElementById('tagDuration');

  // ============================================================
  // Tab 切换逻辑
  // ============================================================
  function switchTab(tabName) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    tabContents.forEach(tc => {
      tc.classList.toggle('active', tc.id === `tab-${tabName}`);
    });
    // 持久化
    try { chrome.storage.local.set({ activeTab: tabName }); } catch (e) {}
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 恢复上次激活的 tab
  chrome.storage.local.get(['activeTab'], (data) => {
    if (data.activeTab) switchTab(data.activeTab);
  });

  // 清空日志
  btnClearLog.addEventListener('click', () => { logEl.innerHTML = ''; });

  // ============================================================
  // 默认预设
  // ============================================================
  const DEFAULT_PRESET = {
    model: 'Seedance 2.0 Fast',
    referenceMode: '全能参考',
    aspectRatio: '16:9',
    duration: '5s',
  };

  let currentPreset = { ...DEFAULT_PRESET };

  // ============================================================
  // Helper: 获取即梦AI标签页
  // ============================================================
  async function getJimengTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) return null;
    // 安全检查 url (需要 tabs 权限)
    if (tab.url && !tab.url.includes('jimeng.jianying.com')) return null;
    return tab;
  }

  // ============================================================
  // 初始化 - 从 storage 加载设置
  // ============================================================
  async function loadSettings() {
    try {
      const data = await chrome.storage.local.get(['preset', 'prompt', 'taskDelay']);
      if (data.preset) {
        currentPreset = { ...DEFAULT_PRESET, ...data.preset };
      }
      if (data.prompt) {
        promptInput.value = data.prompt;
      }
      if (data.taskDelay) {
        taskDelayInput.value = data.taskDelay;
      }
      updatePresetDisplay();
    } catch (e) {
      console.warn('加载设置失败:', e);
    }
  }

  async function saveSettings() {
    try {
      await chrome.storage.local.set({
        preset: currentPreset,
        prompt: promptInput.value,
        taskDelay: parseInt(taskDelayInput.value) || 2,
      });
    } catch (e) {
      console.warn('保存设置失败:', e);
    }
  }

  function updatePresetDisplay() {
    tagModel.textContent = `🤖 ${currentPreset.model}`;
    tagRefMode.textContent = `⚡ ${currentPreset.referenceMode}`;
    tagRatio.textContent = `📐 ${currentPreset.aspectRatio}`;
    tagDuration.textContent = `⏱️ ${currentPreset.duration}`;

    cfgModel.value = currentPreset.model;
    cfgRefMode.value = currentPreset.referenceMode;
    cfgRatio.value = currentPreset.aspectRatio;
    cfgDuration.value = currentPreset.duration;
  }

  // ============================================================
  // 收起按钮 → 通知 content script 关闭抽屉
  // ============================================================
  btnCollapse.addEventListener('click', () => {
    // 通过 postMessage 通知父页面 (content script) 关闭抽屉
    window.parent.postMessage({ type: 'SEEDANCE_DRAWER_TOGGLE', open: false }, '*');
  });

  // ============================================================
  // 预设编辑器
  // ============================================================
  presetEditToggle.addEventListener('click', () => {
    presetDisplay.style.display = 'none';
    presetEditor.style.display = 'block';
    presetEditToggle.style.display = 'none';
  });

  presetCancel.addEventListener('click', () => {
    presetDisplay.style.display = 'grid';
    presetEditor.style.display = 'none';
    presetEditToggle.style.display = 'inline';
    updatePresetDisplay();
  });

  presetSave.addEventListener('click', () => {
    currentPreset = {
      model: cfgModel.value,
      referenceMode: cfgRefMode.value,
      aspectRatio: cfgRatio.value,
      duration: cfgDuration.value,
    };
    presetDisplay.style.display = 'grid';
    presetEditor.style.display = 'none';
    presetEditToggle.style.display = 'inline';
    updatePresetDisplay();
    saveSettings();
  });

  // 自动保存 prompt 和 delay
  promptInput.addEventListener('blur', saveSettings);
  taskDelayInput.addEventListener('change', saveSettings);

  // ============================================================
  // 连接检查
  // ============================================================
  async function checkConnection() {
    try {
      const tab = await getJimengTab();
      if (!tab) {
        showConnStatus('请打开即梦AI页面', false);
        return false;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (response && response.ready) {
        showConnStatus('✅ 已连接即梦AI页面', true);
        return true;
      }
    } catch (e) {
      showConnStatus('❌ 未连接 - 请刷新即梦AI页面', false);
    }
    return false;
  }

  function showConnStatus(msg, connected) {
    connStatus.textContent = msg;
    connStatus.className = 'conn-status ' + (connected ? 'connected' : 'disconnected');
  }

  btnCheckPage.addEventListener('click', async () => {
    btnCheckPage.textContent = '⏳ 检查中...';
    btnCheckPage.disabled = true;
    await checkConnection();
    btnCheckPage.textContent = '🔗 检查连接';
    btnCheckPage.disabled = false;
  });

  // 面板打开时自动检查连接
  checkConnection();

  // ============================================================
  // 文件上传区域
  // ============================================================
  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#e94560';
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#0f3460';
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#0f3460';
    handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  function handleFiles(files) {
    const ALLOWED_TYPES = [
      'image/jpeg', 'image/png', 'image/webp', 'image/bmp',
      'video/mp4', 'video/quicktime',
    ];
    const mediaFiles = Array.from(files).filter(f =>
      ALLOWED_TYPES.includes(f.type)
    );
    const remaining = MAX_FILES - selectedFiles.length;
    const toAdd = mediaFiles.slice(0, remaining);
    selectedFiles = selectedFiles.concat(toAdd);
    updateUI();
  }

  function updateUI() {
    const count = selectedFiles.length;

    statusBar.style.display = count > 0 ? 'flex' : 'none';
    fileCount.textContent = `${count} / ${MAX_FILES} 张`;

    // 有文件时收起上传区域为小按钮，无文件时展开
    if (count > 0) {
      uploadArea.style.padding = '6px 10px';
      uploadArea.querySelector('.icon').style.display = 'none';
      uploadArea.querySelector('.hint').style.display = 'none';
      uploadArea.querySelector('.text').textContent = '+ 添加更多';
      uploadArea.querySelector('.text').style.fontSize = '11px';
    } else {
      uploadArea.style.padding = '16px 10px';
      uploadArea.querySelector('.icon').style.display = '';
      uploadArea.querySelector('.hint').style.display = '';
      uploadArea.querySelector('.text').textContent = '点击或拖拽添加参考图/视频';
      uploadArea.querySelector('.text').style.fontSize = '12px';
    }

    fileList.innerHTML = '';
    const quickInsertRow = document.getElementById('quickInsertRow');
    quickInsertRow.innerHTML = '';
    // 统计图片/视频序号
    let imgN = 0, vidN = 0;
    const fileTags = []; // { label, safeName }
    selectedFiles.forEach((file, idx) => {
      const isVideo = file.type.startsWith('video/');
      const label = isVideo ? `视频${++vidN}` : `图片${++imgN}`;
      const safeName = sanitizeFileName(file.name);
      fileTags.push({ label, safeName });
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="name">${idx + 1}. [${label}] ${safeName}</span>
        <span class="preview-btn" data-idx="${idx}" title="预览">👁</span>
        <span class="insert-tag" data-tag="${safeName}">@</span>
        <span class="remove" data-idx="${idx}">✕</span>
      `;
      fileList.appendChild(item);
    });

    // 在文件列表下方生成快捷插入按钮
    if (fileTags.length > 0) {
      fileTags.forEach(({ label, safeName }) => {
        const btn = document.createElement('span');
        btn.className = 'qi-tag';
        btn.textContent = `(@${safeName})`;
        btn.dataset.tag = safeName;
        quickInsertRow.appendChild(btn);
      });
    }

    // 快捷插入点击事件 (文件列表 @ 按钮 + 底部标签)
    function insertTagToPrompt(tagName) {
      const tag = `(@${tagName})`;
      const ta = document.getElementById('promptInput');
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      ta.value = val.substring(0, start) + tag + val.substring(end);
      ta.selectionStart = ta.selectionEnd = start + tag.length;
      ta.focus();
    }

    // 预览按钮点击
    fileList.querySelectorAll('.preview-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const file = selectedFiles[idx];
        if (!file) return;
        showFilePreview(file);
      });
    });

    fileList.querySelectorAll('.insert-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        insertTagToPrompt(e.target.dataset.tag);
      });
    });

    quickInsertRow.querySelectorAll('.qi-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        insertTagToPrompt(e.target.dataset.tag);
      });
    });

    fileList.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        selectedFiles.splice(idx, 1);
        updateUI();
      });
    });

    btnDoGenerate.disabled = count === 0;
    btnDoGenerate.textContent = count > 0 ? `📤 上传并填写 (${count}张)` : '📤 上传并填写';
  }

  // ============================================================
  // 文件预览
  // ============================================================
  const previewOverlay = document.getElementById('filePreviewOverlay');
  const previewContent = document.getElementById('previewContent');
  const previewFilename = document.getElementById('previewFilename');
  const previewClose = document.getElementById('previewClose');

  function showFilePreview(file) {
    const url = URL.createObjectURL(file);
    previewFilename.textContent = file.name;
    if (file.type.startsWith('video/')) {
      previewContent.innerHTML = `<video src="${url}" controls autoplay muted style="max-width:90vw;max-height:80vh;"></video>`;
    } else {
      previewContent.innerHTML = `<img src="${url}" alt="${file.name}" style="max-width:90vw;max-height:80vh;">`;
    }
    previewOverlay.classList.add('show');
  }

  function closePreview() {
    previewOverlay.classList.remove('show');
    // revoke blob URL
    const media = previewContent.querySelector('video, img');
    if (media && media.src.startsWith('blob:')) URL.revokeObjectURL(media.src);
    previewContent.innerHTML = '';
  }

  previewClose.addEventListener('click', (e) => { e.stopPropagation(); closePreview(); });
  previewOverlay.addEventListener('click', (e) => { if (e.target === previewOverlay) closePreview(); });

  // ============================================================
  // 清空
  // ============================================================
  btnClear.addEventListener('click', () => {
    selectedFiles = [];
    updateUI();
  });

  // ============================================================
  // 应用预设参数
  // ============================================================
  btnPreset.addEventListener('click', async () => {
    const tab = await getJimengTab();
    if (!tab) {
      alert('请先打开即梦AI生成页面');
      return;
    }

    btnPreset.textContent = '⏳ 应用中...';
    btnPreset.disabled = true;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'applyPreset',
        preset: currentPreset,
      });

      if (response && response.success) {
        btnPreset.textContent = '✅ 预设已应用';
      } else {
        // Fallback: 使用 scripting API 直接注入
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: applyPresetInPage,
          args: [currentPreset],
        });
        btnPreset.textContent = '✅ 预设已应用';
      }

      setTimeout(() => {
        btnPreset.textContent = '🔧 应用预设参数';
        btnPreset.disabled = false;
      }, 2000);
    } catch (err) {
      btnPreset.textContent = '❌ 应用失败';
      console.error(err);
      setTimeout(() => {
        btnPreset.textContent = '🔧 应用预设参数';
        btnPreset.disabled = false;
      }, 2000);
    }
  });

  // ============================================================
  // 文件转 base64
  // ============================================================
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }



  // ============================================================
  // 辅助函数
  // ============================================================
  function addLog(msg, type = '') {
    const p = document.createElement('p');
    p.className = type;
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
    // Keep last 200 entries to prevent memory issues
    while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
    console.log(`[Panel] ${msg}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // 上传并填写 (doGenerate): 上传参考图 + 填写提示词(@mention)
  // ============================================================
  btnDoGenerate.addEventListener('click', async () => {
    if (selectedFiles.length === 0) {
      alert('请先添加参考图');
      return;
    }

    const tab = await getJimengTab();
    if (!tab) {
      alert('请先打开即梦AI生成页面');
      return;
    }

    // 检查连接
    try {
      const pingResp = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (!pingResp || !pingResp.ready) {
        alert('内容脚本未就绪，请刷新即梦AI页面后重试');
        return;
      }
    } catch (e) {
      alert('无法连接到即梦AI页面，请确认页面已打开并刷新');
      return;
    }

    btnDoGenerate.disabled = true;
    btnDoGenerate.textContent = '⏳ 执行中...';
    progressEl.classList.add('active');

    const prompt = promptInput.value.trim();
    const total = selectedFiles.length;
    addLog(`准备上传 ${total} 个文件并填写提示词`);
    addLog(`提示词: ${prompt || '(无)'}`);

    // 将所有文件转为 base64 数据
    progressText.textContent = `正在读取 ${total} 张图片...`;
    progressFill.style.width = '10%';
    const filesData = [];
    for (let i = 0; i < total; i++) {
      const file = selectedFiles[i];
      try {
        const base64 = await fileToBase64(file);
        filesData.push({ name: sanitizeFileName(file.name), data: base64, type: file.type });
        addLog(`📎 已读取 ${i + 1}/${total}: ${file.name}`);
      } catch (err) {
        addLog(`❌ 读取失败: ${file.name} - ${err.message}`, 'error');
      }
    }

    if (filesData.length === 0) {
      addLog('❌ 没有可用的图片数据', 'error');
      btnDoGenerate.textContent = `📤 上传并填写 (${total}张)`;
      btnDoGenerate.disabled = false;
      return;
    }

    progressText.textContent = `正在上传 ${filesData.length} 张图片...`;
    progressFill.style.width = '30%';
    addLog(`📤 开始执行: 清除旧图 → 上传 ${filesData.length} 张 → 填写提示词`);

    try {
      // 一次性发送所有文件数据给 content.js
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'doGenerate',
        files: filesData,
        prompt: prompt,
      });

      progressFill.style.width = '100%';
      if (response && response.success) {
        progressText.textContent = `完成! ${filesData.length} 张图片已上传`;
        addLog(`✅ 全部完成: ${filesData.length} 张图片已上传, 提示词已填写`, 'success');
      } else {
        progressText.textContent = `失败: ${response?.error || '未知错误'}`;
        addLog(`❌ 执行失败: ${response?.error || '未知错误'}`, 'error');
      }
    } catch (err) {
      progressFill.style.width = '100%';
      progressText.textContent = `异常: ${err.message}`;
      addLog(`❌ 执行异常: ${err.message}`, 'error');
    }

    btnDoGenerate.textContent = `📤 上传并填写 (${total}张)`;
    btnDoGenerate.disabled = false;
    saveSettings();
  });

  // ============================================================
  // 提交生成按钮: 点击网页中的生成按钮
  // ============================================================
  btnSubmitGenerate.addEventListener('click', async () => {
    const tab = await getJimengTab();
    if (!tab) {
      alert('请先打开即梦AI生成页面');
      return;
    }

    btnSubmitGenerate.disabled = true;
    btnSubmitGenerate.textContent = '⏳ 提交中...';
    addLog('🚀 点击网页生成按钮...');

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'clickGenerate',
      });

      if (response && response.success) {
        addLog(`✅ 已点击生成按钮 (${response.detail || ''})`, 'success');
        btnSubmitGenerate.textContent = '✅ 已提交';
      } else {
        addLog(`❌ 提交失败: ${response?.error || '未知错误'}`, 'error');
        btnSubmitGenerate.textContent = '❌ 失败';
      }
    } catch (err) {
      addLog(`❌ 提交异常: ${err.message}`, 'error');
      btnSubmitGenerate.textContent = '❌ 异常';
    }

    setTimeout(() => {
      btnSubmitGenerate.textContent = '🚀 提交生成';
      btnSubmitGenerate.disabled = false;
    }, 2000);
  });

  // ============================================================
  // 视频检索与下载
  // ============================================================
  const videoTaskCodeInput = document.getElementById('videoTaskCodeInput');
  const btnSearchVideo = document.getElementById('btnSearchVideo');
  const videoSearchResult = document.getElementById('videoSearchResult');
  const videoStatusText = document.getElementById('videoStatusText');
  const videoHDBadge = document.getElementById('videoHDBadge');
  const videoActions = document.getElementById('videoActions');
  const videoPreview = document.getElementById('videoPreview');
  const btnDownloadVideo = document.getElementById('btnDownloadVideo');
  const btnOpenVideo = document.getElementById('btnOpenVideo');
  const btnUpscaleVideo = document.getElementById('btnUpscaleVideo');
  const btnDownloadHD = document.getElementById('btnDownloadHD');

  let currentVideoUrl = '';
  let currentVideoIsHD = false;
  let videoPollingAbort = false;  // 用于中断手动检索的轮询等待

  function updateHDBadge(isHD, hasHDVersion, hasNormalVersion) {
    if (!videoHDBadge) return;
    const badge = videoHDBadge.querySelector('span');
    if (isHD) {
      badge.textContent = '🟢 高清 HD';
      badge.style.background = 'rgba(76,175,80,0.15)';
      badge.style.color = '#4caf50';
      badge.style.border = '1px solid rgba(76,175,80,0.3)';
      videoHDBadge.style.display = 'block';
    } else if (hasHDVersion) {
      badge.textContent = '🔵 有高清版本可用';
      badge.style.background = 'rgba(33,150,243,0.15)';
      badge.style.color = '#2196f3';
      badge.style.border = '1px solid rgba(33,150,243,0.3)';
      videoHDBadge.style.display = 'block';
    } else {
      badge.textContent = '⚪ 标准分辨率';
      badge.style.background = 'rgba(139,143,163,0.15)';
      badge.style.color = '#8b8fa3';
      badge.style.border = '1px solid rgba(139,143,163,0.3)';
      videoHDBadge.style.display = 'block';
    }
  }

  btnSearchVideo.addEventListener('click', async () => {
    // 如果正在轮询等待，点击按钮则中断
    if (videoPollingAbort === false && btnSearchVideo.textContent.includes('停止等待')) {
      videoPollingAbort = true;
      return;
    }

    const taskCode = videoTaskCodeInput.value.trim();
    if (!taskCode) {
      alert('请输入任务ID');
      return;
    }

    const tab = await getJimengTab();
    if (!tab) {
      alert('请先打开即梦AI生成页面');
      return;
    }

    btnSearchVideo.disabled = true;
    btnSearchVideo.textContent = '⏳ 检索中...';
    videoSearchResult.style.display = 'block';
    videoStatusText.textContent = '🔍 正在页面上检索...';
    videoActions.style.display = 'none';
    videoHDBadge.style.display = 'none';
    videoPreview.innerHTML = '';
    currentVideoUrl = '';
    currentVideoIsHD = false;
    btnUpscaleVideo.style.display = 'none';
    btnDownloadHD.style.display = 'none';

    const VIDEO_POLL_INTERVAL = 5000; // 每5秒检查一次
    const VIDEO_POLL_TIMEOUT = 10 * 60 * 1000; // 最长等待10分钟
    videoPollingAbort = false;

    try {
      const startTime = Date.now();
      let pollCount = 0;
      let response = null;
      let needPoll = true;

      while (needPoll && !videoPollingAbort) {
        pollCount++;
        response = await chrome.tabs.sendMessage(tab.id, {
          action: 'findVideoByTaskCode',
          taskCode: taskCode,
        });

        if (!response || !response.success) {
          videoStatusText.textContent = `❌ 检索失败: ${response?.error || '未知错误'}`;
          addLog(`❌ 视频检索失败: ${response?.error || '未知错误'}`, 'error');
          needPoll = false;
          break;
        }

        // 情况1: 找到记录且正在生成中 (造梦中)
        if (response.found && response.status === 'generating') {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const isUpscaling = response.isHD;
          const actionText = isUpscaling ? '提升分辨率' : '生成';
          videoStatusText.innerHTML = `<span style="color:#5bc0de;">⏳ ${response.message}\n正在等待${actionText}完成... (已等待 ${elapsed}s, 第${pollCount}次检查)</span>`;
          btnSearchVideo.disabled = false;
          btnSearchVideo.textContent = '⏹ 停止等待';
          if (pollCount === 1) addLog(`⏳ ${taskCode} 正在${actionText}中(造梦中)，开始轮询等待...`, 'info');

          // 超时检查
          if (Date.now() - startTime > VIDEO_POLL_TIMEOUT) {
            videoStatusText.innerHTML = `<span style="color:#e94560;">⏰ 等待超时 (${VIDEO_POLL_TIMEOUT / 60000}分钟)，请稍后重试</span>`;
            addLog(`⏰ ${taskCode} 等待生成超时`, 'error');
            needPoll = false;
            break;
          }

          await sleep(VIDEO_POLL_INTERVAL);
          continue;
        }

        // 情况2: 未找到记录但页面有生成中的任务
        if (!response.found && response.pageHasGenerating) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          videoStatusText.innerHTML = `<span style="color:#5bc0de;">⏳ 未找到记录，但页面有任务造梦中...\n等待生成完成后再检索... (已等待 ${elapsed}s, 第${pollCount}次检查)</span>`;
          btnSearchVideo.disabled = false;
          btnSearchVideo.textContent = '⏹ 停止等待';
          if (pollCount === 1) addLog(`⏳ ${taskCode} 未找到但页面有任务造梦中，开始轮询等待...`, 'info');

          if (Date.now() - startTime > VIDEO_POLL_TIMEOUT) {
            videoStatusText.innerHTML = `<span style="color:#e94560;">⏰ 等待超时 (${VIDEO_POLL_TIMEOUT / 60000}分钟)，请稍后重试</span>`;
            addLog(`⏰ ${taskCode} 等待生成超时`, 'error');
            needPoll = false;
            break;
          }

          await sleep(VIDEO_POLL_INTERVAL);
          continue;
        }

        // 以下状态不需要继续轮询
        needPoll = false;

        if (!response.found) {
          videoStatusText.textContent = `⚠️ ${response.message}`;
          addLog(`⚠️ 未找到 ${taskCode} 的视频`, 'warning');
        } else if (response.status === 'failed') {
          videoStatusText.innerHTML = `<span style="color:#e94560;">❌ ${response.message}</span>`;
          addLog(`❌ ${taskCode} 生成失败`, 'error');
        } else if (response.status === 'completed' && response.videoUrl) {
          currentVideoUrl = response.videoUrl;
          currentVideoIsHD = !!response.isHD;
          const isImage = response.isImage;
          videoStatusText.innerHTML = `<span style="color:#4caf50;">✅ ${response.message}</span>`;
          if (pollCount > 1) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            videoStatusText.innerHTML += `<br><span style="color:#8b8fa3;font-size:11px;">经过 ${elapsed}s 等待后完成</span>`;
            addLog(`🎉 ${taskCode} 经过 ${elapsed}s 等待后生成完成`, 'success');
          }
          updateHDBadge(response.isHD, response.hasHDVersion, response.hasNormalVersion);
          videoActions.style.display = 'block';

          if (isImage) {
            videoPreview.innerHTML = `<img src="${response.videoUrl}" style="width:100%;border-radius:4px;">`;
          } else {
            videoPreview.innerHTML = `<video src="${response.videoUrl}" controls style="width:100%;border-radius:4px;" preload="metadata"></video>`;
          }

          if (!response.isHD && !response.hasHDVersion && !isImage) {
            btnUpscaleVideo.style.display = '';
          }
          if (response.hasHDVersion && !response.isHD) {
            btnDownloadHD.style.display = '';
          }

          addLog(`✅ 找到 ${taskCode} 的${isImage ? '图片' : '视频'}${response.isHD ? ' (高清)' : ''}`, 'success');
        } else {
          videoStatusText.textContent = `ℹ️ ${response.message}`;
          addLog(`ℹ️ ${taskCode}: ${response.message}`);
        }
      }

      // 用户手动中断
      if (videoPollingAbort) {
        videoStatusText.innerHTML += `<br><span style="color:#ff9800;">⏹ 已停止等待</span>`;
        addLog(`⏹ 已停止等待 ${taskCode} 的生成`, 'warning');
      }
    } catch (err) {
      videoStatusText.textContent = `❌ 检索异常: ${err.message}`;
      addLog(`❌ 视频检索异常: ${err.message}`, 'error');
    }

    videoPollingAbort = false;
    btnSearchVideo.textContent = '🔍 检索';
    btnSearchVideo.disabled = false;
  });

  // 原生下载视频 (触发页面上的下载按钮)
  btnDownloadVideo.addEventListener('click', async () => {
    const taskCode = videoTaskCodeInput.value.trim();
    if (!taskCode) return;

    const tab = await getJimengTab();
    if (!tab) return;

    btnDownloadVideo.disabled = true;
    btnDownloadVideo.textContent = '⏳ 下载中...';
    addLog(`⬇️ 触发原生下载: ${taskCode}`);

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'triggerNativeDownload',
        taskCode: taskCode,
        preferHD: true,
      });

      if (response?.downloaded) {
        addLog(`✅ 已触发下载: ${response.message}`, 'success');
        btnDownloadVideo.textContent = '✅ 已触发';
      } else if (response?.fallbackUrl) {
        // 原生下载失败，使用 fetch+blob 方式
        addLog(`⚠️ ${response.message}，使用备用下载`, 'warning');
        await fallbackDownload(response.fallbackUrl, taskCode);
      } else {
        addLog(`❌ 下载失败: ${response?.message || '未知错误'}`, 'error');
        // 如果有 currentVideoUrl，尝试备用下载
        if (currentVideoUrl) {
          await fallbackDownload(currentVideoUrl, taskCode);
        } else {
          btnDownloadVideo.textContent = '❌ 下载失败';
        }
      }
    } catch (err) {
      addLog(`❌ 下载异常: ${err.message}`, 'error');
      if (currentVideoUrl) {
        await fallbackDownload(currentVideoUrl, taskCode);
      } else {
        btnDownloadVideo.textContent = '❌ 下载失败';
      }
    }

    setTimeout(() => {
      btnDownloadVideo.textContent = '⬇️ 原生下载';
      btnDownloadVideo.disabled = false;
    }, 2000);
  });

  // 备用下载方式 (通过 content.js 在页面上下文中 fetch+blob 下载)
  async function fallbackDownload(url, taskCode) {
    const tab = await getJimengTab();
    if (!tab) {
      addLog('❌ 未找到即梦页面，无法下载', 'error');
      window.open(url, '_blank');
      return;
    }
    try {
      const ext = url.includes('.mp4') || !url.includes('image') ? 'mp4' : 'png';
      const filename = `${taskCode || 'video'}.${ext}`;
      addLog(`⬇️ 通过页面下载: ${filename}`);

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'downloadVideoFile',
        url: url,
        filename: filename,
      });

      if (response?.downloaded) {
        addLog(`✅ 下载完成: ${filename} (${Math.round((response.size || 0) / 1024)}KB)`, 'success');
        btnDownloadVideo.textContent = '✅ 已下载';
      } else {
        addLog(`❌ 下载失败: ${response?.message || '未知错误'}`, 'error');
        window.open(url, '_blank');
        btnDownloadVideo.textContent = '❌ 已在新标签打开';
      }
    } catch (err) {
      addLog(`❌ 下载异常: ${err.message}`, 'error');
      window.open(url, '_blank');
      btnDownloadVideo.textContent = '❌ 已在新标签打开';
    }
  }

  // 新标签页打开视频
  btnOpenVideo.addEventListener('click', () => {
    if (!currentVideoUrl) return;
    window.open(currentVideoUrl, '_blank');
    addLog('🔗 已在新标签页打开视频');
  });

  // 提升分辨率
  btnUpscaleVideo.addEventListener('click', async () => {
    const taskCode = videoTaskCodeInput.value.trim();
    if (!taskCode) return;

    const tab = await getJimengTab();
    if (!tab) return;

    btnUpscaleVideo.disabled = true;
    btnUpscaleVideo.textContent = '⏳ 处理中...';
    addLog(`🔺 触发提升分辨率: ${taskCode}`);

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'triggerUpscale',
        taskCode: taskCode,
      });

      if (response?.alreadyHD) {
        addLog(`ℹ️ ${taskCode} 已有高清版本`, 'info');
        btnUpscaleVideo.textContent = '✅ 已有高清';
      } else if (response?.triggered) {
        addLog(`✅ 已触发提升分辨率: ${response.message}`, 'success');
        btnUpscaleVideo.textContent = '✅ 已触发';
      } else {
        addLog(`❌ 提升分辨率失败: ${response?.message || '未知错误'}`, 'error');
        btnUpscaleVideo.textContent = '❌ 失败';
      }
    } catch (err) {
      addLog(`❌ 提升分辨率异常: ${err.message}`, 'error');
      btnUpscaleVideo.textContent = '❌ 失败';
    }

    setTimeout(() => {
      btnUpscaleVideo.textContent = '🔺 提升分辨率';
      btnUpscaleVideo.disabled = false;
    }, 2000);
  });

  // 下载高清版本 (当搜到标准版本但存在HD版本时)
  btnDownloadHD.addEventListener('click', async () => {
    const taskCode = videoTaskCodeInput.value.trim();
    if (!taskCode) return;

    const tab = await getJimengTab();
    if (!tab) return;

    btnDownloadHD.disabled = true;
    btnDownloadHD.textContent = '⏳ 下载中...';
    addLog(`⬇️ 下载高清版本: ${taskCode}`);

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'triggerNativeDownload',
        taskCode: taskCode,
        preferHD: true,
      });

      if (response?.downloaded) {
        addLog(`✅ 已触发高清下载: ${response.message}`, 'success');
        btnDownloadHD.textContent = '✅ 已触发';
      } else if (response?.fallbackUrl) {
        await fallbackDownload(response.fallbackUrl, taskCode + '-HD');
      } else {
        addLog(`❌ 高清下载失败: ${response?.message || '未知错误'}`, 'error');
        btnDownloadHD.textContent = '❌ 失败';
      }
    } catch (err) {
      addLog(`❌ 高清下载异常: ${err.message}`, 'error');
      btnDownloadHD.textContent = '❌ 失败';
    }

    setTimeout(() => {
      btnDownloadHD.textContent = '⬇️ 下载高清';
      btnDownloadHD.disabled = false;
    }, 2000);
  });

  // 上传视频到服务器
  const btnUploadServer = document.getElementById('btnUploadServer');
  btnUploadServer.addEventListener('click', async () => {
    const taskCode = videoTaskCodeInput.value.trim();
    if (!taskCode) {
      addLog('⚠️ 请先输入任务号', 'error');
      return;
    }

    const apiBaseUrl = apiUrlInput?.value?.trim();
    if (!apiBaseUrl) {
      addLog('⚠️ 请先配置服务器地址 (API连接 标签页)', 'error');
      return;
    }

    const tab = await getJimengTab();
    if (!tab) return;

    btnUploadServer.disabled = true;
    btnUploadServer.textContent = '⏳ 上传中...';
    addLog(`📤 捕获并上传视频: ${taskCode} → ${apiBaseUrl}`);

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'captureAndUpload',
        taskCode: taskCode,
        serverUrl: apiBaseUrl,
      });

      if (response?.success && response?.uploaded > 0) {
        const details = (response.results || [])
          .filter(r => r.success)
          .map(r => `${r.quality}(${Math.round((r.size || 0) / 1024)}KB)`)
          .join(', ');
        addLog(`✅ 已上传 ${response.uploaded} 个文件: ${details}`, 'success');
        addLog(`📁 查看文件: ${apiBaseUrl}/files`, 'success');
        btnUploadServer.textContent = '✅ 已上传';
      } else {
        addLog(`❌ 上传失败: ${response?.message || '未知错误'}`, 'error');
        btnUploadServer.textContent = '❌ 上传失败';
      }
    } catch (err) {
      addLog(`❌ 上传异常: ${err.message}`, 'error');
      btnUploadServer.textContent = '❌ 上传失败';
    }

    setTimeout(() => {
      btnUploadServer.textContent = '📤 上传服务器';
      btnUploadServer.disabled = false;
    }, 3000);
  });

  // ============================================================
  // 直接注入页面执行预设参数 (备用方案)
  // ============================================================
  function applyPresetInPage(preset) {
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function simulateClick(el) {
      if (!el) return;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    function findToolbar() {
      const toolbars = document.querySelectorAll('[class*="toolbar-settings-content"]');
      for (const tb of toolbars) {
        if (tb.offsetParent !== null && !tb.className.includes('collapsed')) return tb;
      }
      for (const tb of toolbars) {
        if (tb.offsetParent !== null) return tb;
      }
      return null;
    }

    async function selectOption(selectEl, targetText) {
      if (!selectEl) return false;
      if (selectEl.textContent.trim() === targetText) return true;
      simulateClick(selectEl);
      await sleep(500);
      const options = document.querySelectorAll('.lv-select-option');
      for (const opt of options) {
        if (opt.textContent.trim() === targetText || opt.textContent.trim().startsWith(targetText)) {
          simulateClick(opt);
          await sleep(300);
          return true;
        }
      }
      document.body.click();
      return false;
    }

    return (async () => {
      // Step 0: 确保在视频生成模式
      let toolbar = findToolbar();
      if (toolbar) {
        const selects = toolbar.querySelectorAll('.lv-select');
        const currentType = selects[0]?.textContent.trim();
        if (currentType !== '视频生成') {
          simulateClick(selects[0]);
          await sleep(500);
          const options = document.querySelectorAll('.lv-select-option');
          for (const opt of options) {
            if (opt.textContent.trim() === '视频生成' || opt.textContent.trim().startsWith('视频生成')) {
              simulateClick(opt);
              break;
            }
          }
          await sleep(2000);
        }
      }

      toolbar = findToolbar();
      if (!toolbar) {
        console.warn('[预设] 未找到工具栏');
        return;
      }

      const selects = toolbar.querySelectorAll('.lv-select');

      if (preset.model && selects[1]) {
        await selectOption(selects[1], preset.model);
        await sleep(400);
      }

      if (preset.referenceMode && selects[2]) {
        await selectOption(selects[2], preset.referenceMode);
        await sleep(400);
      }

      if (preset.aspectRatio) {
        const ratioBtn = toolbar.querySelector('button[class*="toolbar-button"]');
        if (ratioBtn && !ratioBtn.textContent.includes(preset.aspectRatio)) {
          simulateClick(ratioBtn);
          await sleep(500);
          const labels = document.querySelectorAll('[class*="label-"]');
          for (const label of labels) {
            if (label.textContent.trim() === preset.aspectRatio && label.offsetParent !== null) {
              const clickTarget = label.closest('[class*="ratio-option"]') || label.parentElement || label;
              simulateClick(clickTarget);
              break;
            }
          }
          await sleep(400);
        }
      }

      if (preset.duration && selects[3]) {
        await selectOption(selects[3], preset.duration);
        await sleep(400);
      }

      console.log('[预设] 参数应用完毕');
    })();
  }

  // ============================================================
  // 启动
  // ============================================================
  loadSettings();

  // ============================================================
  // 任务队列管理
  // ============================================================
  const btnFetchTasks = document.getElementById('btnFetchTasks');
  const btnAutoExec = document.getElementById('btnAutoExec');
  const btnClearTasks = document.getElementById('btnClearTasks');
  const btnClearAllTasks = document.getElementById('btnClearAllTasks');
  const apiUrlInput = document.getElementById('apiUrlInput');
  const taskListEl = document.getElementById('taskList');
  const statPending = document.getElementById('statPending');
  const statRunning = document.getElementById('statRunning');
  const statGenerating = document.getElementById('statGenerating');
  const statUpscaling = document.getElementById('statUpscaling');
  const statCompleted = document.getElementById('statCompleted');
  const statFailed = document.getElementById('statFailed');

  let taskQueue = [];        // 本地任务队列
  let isAutoExecuting = false;
  let autoExecAbort = false;

  // SSE 长连接相关
  const btnSSEToggle = document.getElementById('btnSSEToggle');
  const sseStatusRow = document.getElementById('sseStatusRow');
  const sseIndicator = document.getElementById('sseIndicator');
  const sseStatusText = document.getElementById('sseStatusText');
  const sseClientIdEl = document.getElementById('sseClientId');
  let sseSource = null;      // EventSource 实例
  let sseConnected = false;
  // 持久化 clientId: 如果之前存过就复用，否则生成新的
  let clientId = '';

  // --- 加载/保存任务队列 ---
  async function loadTaskQueue() {
    try {
      const data = await chrome.storage.local.get(['taskQueue', 'apiBaseUrl', 'clientId']);
      if (data.taskQueue) taskQueue = data.taskQueue;
      if (data.apiBaseUrl) apiUrlInput.value = data.apiBaseUrl;
      // 恢复或生成 clientId
      if (data.clientId) {
        clientId = data.clientId;
      } else {
        clientId = 'ext-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
        chrome.storage.local.set({ clientId });
      }
      console.log('[Panel] clientId:', clientId);
      renderTaskList();
    } catch (e) {
      console.warn('加载任务队列失败:', e);
    }
  }

  async function saveTaskQueue() {
    try {
      await chrome.storage.local.set({
        taskQueue,
        apiBaseUrl: apiUrlInput.value.trim(),
      });
    } catch (e) {
      console.warn('保存任务队列失败:', e);
    }
  }

  // 自动保存 API 配置
  apiUrlInput.addEventListener('blur', saveTaskQueue);

  // --- API 直接请求 (panel 是 extension page，可直接 fetch) ---
  async function apiFetch(apiBaseUrl, path, options = {}) {
    const url = `${apiBaseUrl}${path}`;
    console.log(`[Panel API] ${options.method || 'GET'} ${url}`);
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    return resp.json();
  }

  // --- 拉取任务 (手动按钮，委托给公共方法) ---
  btnFetchTasks.addEventListener('click', () => fetchTasksFromAPI());

  // --- 清空已完成/失败任务 ---
  btnClearTasks.addEventListener('click', () => {
    taskQueue = taskQueue.filter(t => t.status === 'pending' || t.status === 'running');
    saveTaskQueue();
    renderTaskList();
    addLog('🗑️ 已清空完成/失败任务');
  });

  // --- 清空全部任务 ---
  btnClearAllTasks.addEventListener('click', () => {
    if (taskQueue.length === 0) return;
    taskQueue = [];
    saveTaskQueue();
    renderTaskList();
    addLog('🗑️ 已清空全部任务');
  });

  // --- 渲染任务列表 ---
  function renderTaskList() {
    // 更新统计 (按流水线状态分组)
    const counts = { pending: 0, running: 0, generating: 0, upscaling: 0, completed: 0, failed: 0 };
    taskQueue.forEach(t => {
      if (t.status === 'pending') counts.pending++;
      else if (t.status === 'configuring' || t.status === 'uploading' || t.status === 'uploading_hd') counts.running++;
      else if (t.status === 'generating') counts.generating++;
      else if (t.status === 'upscaling') counts.upscaling++;
      else if (t.status === 'completed') counts.completed++;
      else if (t.status === 'failed') counts.failed++;
      else if (t.status === 'running') counts.running++;
    });
    statPending.textContent = counts.pending;
    statRunning.textContent = counts.running;
    statGenerating.textContent = counts.generating;
    statUpscaling.textContent = counts.upscaling;
    statCompleted.textContent = counts.completed;
    statFailed.textContent = counts.failed;

    // 更新 tab badge
    const total = taskQueue.length;
    taskCountBadge.textContent = total > 0 ? total : '';

    // 渲染卡片
    taskListEl.innerHTML = '';
    taskQueue.forEach((task, idx) => {
      const card = document.createElement('div');
      card.className = `task-card status-${task.status}`;
      card.dataset.taskCode = task.taskCode;

      const statusLabels = {
        pending: '待处理',
        configuring: '⚙️ 配置中',
        running: '执行中',
        generating: '🎬 生成中',
        uploading: '📤 上传标清',
        upscaling: '🔺 提升中',
        uploading_hd: '📤 上传高清',
        completed: '已完成',
        failed: '失败',
      };
      const statusLabel = statusLabels[task.status] || task.status;

      const metaTags = [];
      if (task.modelConfig) {
        metaTags.push(task.modelConfig.model || '');
        metaTags.push(task.modelConfig.referenceMode || '');
        metaTags.push(task.modelConfig.aspectRatio || '');
        metaTags.push(task.modelConfig.duration || '');
      }
      if (task.referenceFiles) {
        metaTags.push(`${task.referenceFiles.length}张参考图`);
      }
      if (task.tags && task.tags.length > 0) {
        metaTags.push(...task.tags);
      }
      if (task.realSubmit) {
        metaTags.push('🔴 真实提交');
      } else {
        metaTags.push('🟢 模拟');
      }

      const timeStr = task.createdAt
        ? new Date(task.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' })
        : '';

      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-code">${task.taskCode}</span>
          <span class="task-status-badge badge-${task.status}">${statusLabel}</span>
        </div>
        <div class="task-card-body">
          ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
          <div class="task-prompt">💬 ${escapeHtml(task.prompt || '(无提示词)')}</div>
        </div>
        <div class="task-card-meta">
          ${metaTags.filter(Boolean).map(t => `<span class="task-meta-tag">${escapeHtml(t)}</span>`).join('')}
          ${timeStr ? `<span class="task-meta-tag">🕐 ${timeStr}</span>` : ''}
        </div>
        <div class="task-card-actions">
          ${task.status === 'pending' ? `
            <button class="btn-exec" data-idx="${idx}" title="执行此任务">▶ 执行</button>
            <button class="btn-skip" data-idx="${idx}" title="跳过此任务">跳过</button>
          ` : ''}
          ${task.status === 'failed' ? `
            <button class="btn-exec" data-idx="${idx}" title="重试此任务">🔄 重试</button>
          ` : ''}
          ${task.error ? `<span style="font-size:9px;color:#e94560;" title="${escapeHtml(task.error)}">⚠️ ${escapeHtml(task.error).substring(0, 20)}</span>` : ''}
        </div>
      `;

      taskListEl.appendChild(card);
    });

    // 绑定执行按钮
    taskListEl.querySelectorAll('.btn-exec').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        executeTask(idx);
      });
    });

    // 绑定跳过按钮
    taskListEl.querySelectorAll('.btn-skip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        taskQueue[idx].status = 'completed';
        taskQueue[idx].completedAt = new Date().toISOString();
        saveTaskQueue();
        renderTaskList();
        addLog(`⏭️ 跳过任务: ${taskQueue[idx].taskCode}`);
      });
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- 执行单个任务 (配置参数 + 提交生成) ---
  // 流水线: pending → configuring → generating → (monitor接管)
  async function executeTask(idx) {
    const task = taskQueue[idx];
    if (!task || !['pending', 'failed'].includes(task.status)) return;

    const tab = await getJimengTab();
    if (!tab) {
      addLog('❌ 请先打开即梦AI生成页面', 'error');
      return;
    }

    // 检查连接
    try {
      const pingResp = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (!pingResp || !pingResp.ready) {
        addLog('❌ 内容脚本未就绪', 'error');
        return;
      }
    } catch (e) {
      addLog('❌ 无法连接到即梦AI页面', 'error');
      return;
    }

    // 更新状态 → configuring
    task.status = 'configuring';
    task.executedAt = new Date().toISOString();
    task.error = null;
    task.pipelineRetries = 0;  // 流水线重试计数
    await saveTaskQueue();
    renderTaskList();
    addLog(`▶ 开始配置任务: ${task.taskCode}`);
    reportTaskStatus(task.taskCode, 'configuring');

    try {
      // 1. 应用模型配置 (预设参数)
      if (task.modelConfig) {
        addLog(`🔧 应用模型配置: ${task.modelConfig.model} / ${task.modelConfig.referenceMode}`);
        await chrome.tabs.sendMessage(tab.id, {
          action: 'applyPreset',
          preset: task.modelConfig,
        });
        await sleep(2000);
      }

      // 2. 构建文件数据 + 提示词
      const filesData = (task.referenceFiles || []).map(f => ({
        name: sanitizeFileName(f.fileName),
        data: f.base64,
        type: f.fileType,
      }));

      const finalPrompt = task.prompt || '';

      addLog(`📤 上传 ${filesData.length} 张参考图 + 填写提示词`);
      addLog(`📝 提示词: "${finalPrompt.substring(0, 60)}..."`);

      // 3. 调用 doGenerate
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'doGenerate',
        files: filesData,
        prompt: finalPrompt,
      });

      if (response && response.success) {
        // 4. 点击生成按钮
        if (task.realSubmit) {
          addLog(`🚀 真实提交: 点击生成按钮...`);
          await chrome.tabs.sendMessage(tab.id, { action: 'clickGenerate' });

          // 进入「生成中」状态,交给 monitor 接管后续流程
          task.status = 'generating';
          task.generatingStartedAt = new Date().toISOString();
          addLog(`🎬 任务 ${task.taskCode} 已提交，等待视频生成...`, 'success');
          reportTaskStatus(task.taskCode, 'generating');
        } else {
          addLog(`🟢 模拟模式: 跳过点击生成按钮`);
          task.status = 'completed';
          task.completedAt = new Date().toISOString();
          addLog(`✅ 模拟任务完成: ${task.taskCode}`, 'success');
          reportTaskStatus(task.taskCode, 'completed');
        }
      } else {
        throw new Error(response?.error || '执行失败');
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err.message;
      task.completedAt = new Date().toISOString();
      addLog(`❌ 任务配置失败 ${task.taskCode}: ${err.message}`, 'error');
      reportTaskStatus(task.taskCode, 'failed', err.message);
    }

    await saveTaskQueue();
    renderTaskList();
  }

  // --- 向服务器报告任务状态 ---
  function reportTaskStatus(taskCode, status, error = null) {
    const apiBaseUrl = apiUrlInput.value.trim();
    if (!apiBaseUrl) return;
    apiFetch(apiBaseUrl, '/api/tasks/status', {
      method: 'POST',
      body: {
        taskCode,
        status,
        error,
        updatedAt: new Date().toISOString(),
      },
    }).catch(e => console.warn('[Panel] 报告状态失败:', e));
  }

  // ============================================================
  // 流水线监控器: 轮询 generating / upscaling 状态的任务
  // ============================================================
  const PIPELINE_POLL_INTERVAL = 10000; // 10 秒轮询一次
  const PIPELINE_MAX_RETRIES = 3;       // 上传/提升失败最多重试次数
  const PIPELINE_TIMEOUT = 10 * 60 * 1000; // 10 分钟超时

  async function monitorPipelineTasks() {
    const tab = await getJimengTab();
    if (!tab) return; // 如果即梦页面未打开, 跳过本轮检查

    // 检查连接
    try {
      const pingResp = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      if (!pingResp || !pingResp.ready) return;
    } catch (e) { return; }

    let hasChanges = false;

    // --- 处理「生成中」的任务 ---
    for (const task of taskQueue) {
      if (task.status !== 'generating') continue;
      try {
        // 超时检查
        const elapsed = Date.now() - new Date(task.generatingStartedAt || task.executedAt).getTime();
        if (elapsed > PIPELINE_TIMEOUT) {
          task.status = 'failed';
          task.error = '视频生成超时 (10分钟)';
          task.completedAt = new Date().toISOString();
          addLog(`⏰ 任务 ${task.taskCode} 生成超时`, 'error');
          reportTaskStatus(task.taskCode, 'failed', task.error);
          hasChanges = true;
          continue;
        }

        // 查找视频
        const result = await chrome.tabs.sendMessage(tab.id, {
          action: 'findVideoByTaskCode',
          taskCode: task.taskCode,
        });

        if (!result || !result.found) {
          // 视频尚未出现, 继续等待
          continue;
        }

        if (result.status === 'generating') {
          // 仍在生成中, 继续等待
          continue;
        }

        if (result.status === 'failed') {
          task.status = 'failed';
          task.error = '视频生成失败';
          task.completedAt = new Date().toISOString();
          addLog(`❌ 任务 ${task.taskCode} 视频生成失败`, 'error');
          reportTaskStatus(task.taskCode, 'failed', task.error);
          hasChanges = true;
          continue;
        }

        if (result.status === 'completed' && result.videoUrl) {
          // 视频生成完成! 上传标清版本
          addLog(`🎉 任务 ${task.taskCode} 视频生成完成, 开始上传标清视频...`, 'success');
          task.status = 'uploading';
          hasChanges = true;
          renderTaskList();
          reportTaskStatus(task.taskCode, 'uploading');

          const apiBaseUrl = apiUrlInput.value.trim();
          if (apiBaseUrl) {
            try {
              const uploadResult = await chrome.tabs.sendMessage(tab.id, {
                action: 'captureAndUpload',
                taskCode: task.taskCode,
                serverUrl: apiBaseUrl,
                quality: 'standard',  // 仅上传标清
              });
              if (uploadResult && uploadResult.uploaded > 0) {
                addLog(`📤 任务 ${task.taskCode} 标清视频已上传 (${uploadResult.uploaded}个)`, 'success');
              } else {
                addLog(`⚠️ 任务 ${task.taskCode} 标清视频上传失败: ${uploadResult?.message || '未知'}`, 'error');
              }
            } catch (uploadErr) {
              addLog(`⚠️ 任务 ${task.taskCode} 标清上传异常: ${uploadErr.message}`, 'error');
            }
          }

          // 触发提升分辨率
          addLog(`🔺 任务 ${task.taskCode} 触发提升分辨率...`);
          try {
            const upscaleResult = await chrome.tabs.sendMessage(tab.id, {
              action: 'triggerUpscale',
              taskCode: task.taskCode,
            });

            if (upscaleResult && upscaleResult.triggered) {
              task.status = 'upscaling';
              task.upscalingStartedAt = new Date().toISOString();
              addLog(`🔺 任务 ${task.taskCode} 已开始提升分辨率`, 'success');
              reportTaskStatus(task.taskCode, 'upscaling');
            } else if (upscaleResult && upscaleResult.alreadyHD) {
              // 已经是高清了，直接完成
              task.status = 'completed';
              task.completedAt = new Date().toISOString();
              addLog(`✅ 任务 ${task.taskCode} 已是高清，流水线完成`, 'success');
              reportTaskStatus(task.taskCode, 'completed');
            } else {
              // 提升失败，记录但继续尝试
              task.pipelineRetries = (task.pipelineRetries || 0) + 1;
              if (task.pipelineRetries >= PIPELINE_MAX_RETRIES) {
                task.status = 'completed'; // 标清已上传, 视为部分完成
                task.completedAt = new Date().toISOString();
                task.error = '提升分辨率失败(已上传标清)';
                addLog(`⚠️ 任务 ${task.taskCode} 提升分辨率失败, 标清已上传`, 'error');
                reportTaskStatus(task.taskCode, 'completed', task.error);
              } else {
                task.status = 'generating'; // 回到生成状态,下轮重试
                addLog(`⚠️ 任务 ${task.taskCode} 提升分辨率未成功, 稍后重试 (${task.pipelineRetries}/${PIPELINE_MAX_RETRIES})`);
              }
            }
          } catch (upErr) {
            task.pipelineRetries = (task.pipelineRetries || 0) + 1;
            if (task.pipelineRetries >= PIPELINE_MAX_RETRIES) {
              task.status = 'completed';
              task.completedAt = new Date().toISOString();
              task.error = '提升分辨率异常(已上传标清)';
              addLog(`⚠️ 任务 ${task.taskCode} 提升分辨率异常: ${upErr.message}`, 'error');
              reportTaskStatus(task.taskCode, 'completed', task.error);
            } else {
              task.status = 'generating';
              addLog(`⚠️ 提升分辨率异常, 稍后重试 (${task.pipelineRetries}/${PIPELINE_MAX_RETRIES})`);
            }
          }
          hasChanges = true;
        }
      } catch (err) {
        console.warn(`[Pipeline] 监控 ${task.taskCode} 异常:`, err);
      }
    }

    // --- 处理「提升中」的任务 ---
    for (const task of taskQueue) {
      if (task.status !== 'upscaling') continue;
      try {
        // 超时检查
        const elapsed = Date.now() - new Date(task.upscalingStartedAt || task.executedAt).getTime();
        if (elapsed > PIPELINE_TIMEOUT) {
          task.status = 'completed'; // 标清已上传, 视为部分完成
          task.completedAt = new Date().toISOString();
          task.error = '提升分辨率超时(已上传标清)';
          addLog(`⏰ 任务 ${task.taskCode} 提升分辨率超时`, 'error');
          reportTaskStatus(task.taskCode, 'completed', task.error);
          hasChanges = true;
          continue;
        }

        // 查找HD版本
        const result = await chrome.tabs.sendMessage(tab.id, {
          action: 'findVideoByTaskCode',
          taskCode: task.taskCode,
        });

        if (!result || !result.found) continue;

        // 仍在提升分辨率中 (造梦中)
        if (result.status === 'generating') {
          // 继续等待
          continue;
        }

        // 检查是否有高清版本且已完成
        if (result.hasHDVersion && result.isHD && result.status === 'completed' && result.videoUrl) {
          // HD版本完成! 上传高清视频
          addLog(`🎉 任务 ${task.taskCode} 高清版本就绪, 开始上传...`, 'success');
          task.status = 'uploading_hd';
          hasChanges = true;
          renderTaskList();
          reportTaskStatus(task.taskCode, 'uploading_hd');

          const apiBaseUrl = apiUrlInput.value.trim();
          if (apiBaseUrl) {
            try {
              const uploadResult = await chrome.tabs.sendMessage(tab.id, {
                action: 'captureAndUpload',
                taskCode: task.taskCode,
                serverUrl: apiBaseUrl,
                quality: 'hd',  // 仅上传高清
              });
              if (uploadResult && uploadResult.uploaded > 0) {
                addLog(`📤 任务 ${task.taskCode} 高清视频已上传`, 'success');
              } else {
                addLog(`⚠️ 任务 ${task.taskCode} 高清视频上传失败: ${uploadResult?.message || '未知'}`, 'error');
              }
            } catch (uploadErr) {
              addLog(`⚠️ 任务 ${task.taskCode} 高清上传异常: ${uploadErr.message}`, 'error');
            }
          }

          // 全部完成
          task.status = 'completed';
          task.completedAt = new Date().toISOString();
          addLog(`✅ 任务 ${task.taskCode} 流水线全部完成!`, 'success');
          reportTaskStatus(task.taskCode, 'completed');
          hasChanges = true;
        } else if (result.isHD && result.status === 'generating') {
          // HD还在处理中, 继续等待
          continue;
        } else if (result.isHD && result.status === 'failed') {
          task.status = 'completed';
          task.completedAt = new Date().toISOString();
          task.error = '提升分辨率处理失败(已上传标清)';
          addLog(`❌ 任务 ${task.taskCode} 提升分辨率处理失败`, 'error');
          reportTaskStatus(task.taskCode, 'completed', task.error);
          hasChanges = true;
        }
        // 如果还没检测到HD版本, 继续等待
      } catch (err) {
        console.warn(`[Pipeline] 监控HD ${task.taskCode} 异常:`, err);
      }
    }

    if (hasChanges) {
      await saveTaskQueue();
      renderTaskList();
    }
  }

  // --- 自动执行：流水线模式 (配置新任务 + 后台监控生成/提升) ---
  btnAutoExec.addEventListener('click', async () => {
    if (isAutoExecuting) {
      // 停止自动执行
      autoExecAbort = true;
      btnAutoExec.textContent = '▶ 自动执行';
      btnAutoExec.classList.remove('active');
      addLog('⏹️ 已停止自动执行');
      return;
    }

    isAutoExecuting = true;
    autoExecAbort = false;
    btnAutoExec.textContent = '⏹ 停止';
    btnAutoExec.classList.add('active');
    addLog('▶ 开始流水线自动执行 (配置→生成→上传→提升→上传高清)');

    const delay = (parseInt(taskDelayInput.value) || 2) * 1000;
    let lastMonitorTime = 0;

    // 流水线主循环: 交替执行 dispatch (配置新任务) 和 monitor (检查进行中的任务)
    while (!autoExecAbort) {
      // --- 1. Monitor: 检查所有进行中的任务状态 ---
      const hasPipelineTasks = taskQueue.some(t =>
        ['generating', 'upscaling'].includes(t.status)
      );
      const now = Date.now();
      if (hasPipelineTasks && now - lastMonitorTime >= PIPELINE_POLL_INTERVAL) {
        lastMonitorTime = now;
        try {
          await monitorPipelineTasks();
        } catch (monErr) {
          console.warn('[Pipeline] 监控异常:', monErr);
        }
      }

      if (autoExecAbort) break;

      // --- 2. Dispatch: 检查是否有正在配置中的任务 (同时只允许一个) ---
      const hasConfiguring = taskQueue.some(t => t.status === 'configuring');
      if (hasConfiguring) {
        // 有任务正在配置中, 等待
        await sleep(2000);
        continue;
      }

      // --- 3. Dispatch: 找到下一个待处理任务 ---
      const nextIdx = taskQueue.findIndex(t => t.status === 'pending');
      if (nextIdx !== -1) {
        await executeTask(nextIdx);
        if (autoExecAbort) break;
        // 配置完成后等待片刻再处理下一个
        const hasMorePending = taskQueue.some(t => t.status === 'pending');
        if (hasMorePending) {
          addLog(`⏳ 等待 ${delay / 1000} 秒后配置下一个任务...`);
          await sleep(delay);
        }
      } else {
        // 没有新任务需要配置, 等待片刻
        // 如果也没有流水线中的任务, 提示等待
        if (!hasPipelineTasks) {
          addLog('📭 暂无待处理任务，等待新任务...');
        }
        await sleep(3000);
      }
    }

    isAutoExecuting = false;
    autoExecAbort = false;
    btnAutoExec.textContent = '▶ 自动执行';
    btnAutoExec.classList.remove('active');
    addLog('🏁 流水线自动执行已停止');
  });

  // ============================================================
  // SSE 长连接管理
  // ============================================================
  function startSSE() {
    const apiBaseUrl = apiUrlInput.value.trim();
    if (!apiBaseUrl) {
      addLog('❌ 请先输入 API 地址', 'error');
      return;
    }
    if (sseSource) stopSSE();

    const sseUrl = `${apiBaseUrl}/api/events?clientId=${encodeURIComponent(clientId)}`;
    addLog(`📡 正在建立 SSE 连接: ${sseUrl}`);
    console.log('[Panel SSE] Connecting:', sseUrl);

    sseSource = new EventSource(sseUrl);

    sseSource.addEventListener('connected', async (e) => {
      sseConnected = true;
      updateSSEStatus('connected');
      const data = JSON.parse(e.data);
      addLog(`📡 SSE 已连接 (clientId: ${data.clientId})`, 'success');
      console.log('[Panel SSE] Connected:', data);
      // 连接成功后自动拉取一次任务
      await fetchTasksFromAPI();
    });

    sseSource.addEventListener('new-tasks', async (e) => {
      const data = JSON.parse(e.data);
      addLog(`🔔 服务器通知: ${data.message}`);
      console.log('[Panel SSE] New tasks notification:', data);
      // 自动拉取任务
      await fetchTasksFromAPI();
    });

    sseSource.addEventListener('task-released', async (e) => {
      const data = JSON.parse(e.data);
      addLog(`🔓 任务 ${data.taskCode} 已释放，可重新领取`);
      console.log('[Panel SSE] Task released:', data);
    });

    sseSource.onerror = (e) => {
      console.warn('[Panel SSE] Error, readyState:', sseSource.readyState);
      if (sseSource.readyState === EventSource.CLOSED) {
        sseConnected = false;
        updateSSEStatus('disconnected');
        addLog('📡 SSE 连接已关闭，5秒后重连...', 'error');
        setTimeout(() => {
          if (!sseConnected && btnSSEToggle.classList.contains('active')) {
            startSSE();
          }
        }, 5000);
      } else {
        updateSSEStatus('reconnecting');
      }
    };
  }

  function stopSSE() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
    sseConnected = false;
    updateSSEStatus('disconnected');
    addLog('📡 SSE 连接已断开');
  }

  function updateSSEStatus(state) {
    sseStatusRow.style.display = 'flex';
    sseClientIdEl.textContent = clientId.substring(0, 16);
    switch (state) {
      case 'connected':
        sseIndicator.style.background = '#4caf50';
        sseStatusText.textContent = '已连接 (等待通知)';
        sseStatusText.style.color = '#4caf50';
        btnSSEToggle.textContent = '📡 断开';
        btnSSEToggle.style.borderColor = '#4caf50';
        btnSSEToggle.style.color = '#4caf50';
        break;
      case 'reconnecting':
        sseIndicator.style.background = '#f0ad4e';
        sseStatusText.textContent = '重连中...';
        sseStatusText.style.color = '#f0ad4e';
        break;
      case 'disconnected':
        sseIndicator.style.background = '#555';
        sseStatusText.textContent = '未连接';
        sseStatusText.style.color = '#8b8fa3';
        btnSSEToggle.textContent = '📡 连接';
        btnSSEToggle.style.borderColor = '#0f3460';
        btnSSEToggle.style.color = '#8b8fa3';
        btnSSEToggle.classList.remove('active');
        break;
    }
  }

  btnSSEToggle.addEventListener('click', () => {
    if (sseConnected || sseSource) {
      stopSSE();
      btnSSEToggle.classList.remove('active');
    } else {
      btnSSEToggle.classList.add('active');
      startSSE();
    }
  });

  // --- 提取公共拉取逻辑供 SSE 回调复用 ---
  async function fetchTasksFromAPI() {
    const apiBaseUrl = apiUrlInput.value.trim();
    if (!apiBaseUrl) return;

    btnFetchTasks.disabled = true;
    btnFetchTasks.textContent = '⏳ 拉取中...';
    addLog(`🔄 正在从 ${apiBaseUrl} 拉取任务 (clientId: ${clientId.substring(0, 12)})...`);

    try {
      const data = await apiFetch(apiBaseUrl, `/api/tasks/pending?clientId=${encodeURIComponent(clientId)}`);
      console.log('[Panel] 拉取结果:', data);

      if (data && data.success && data.tasks && data.tasks.length > 0) {
        const existingCodes = new Set(taskQueue.map(t => t.taskCode));
        let newCount = 0;
        for (const task of data.tasks) {
          if (!existingCodes.has(task.taskCode)) {
            taskQueue.push({
              ...task,
              status: 'pending',
              receivedAt: new Date().toISOString(),
              executedAt: null,
              completedAt: null,
              error: null,
            });
            newCount++;
          }
        }

        if (newCount > 0) {
          const newCodes = data.tasks
            .filter(t => !existingCodes.has(t.taskCode))
            .map(t => t.taskCode);
          try {
            await apiFetch(apiBaseUrl, '/api/tasks/ack', {
              method: 'POST',
              body: { taskCodes: newCodes },
            });
          } catch (ackErr) {
            console.warn('[Panel] ack 失败:', ackErr);
          }
          addLog(`📥 拉取到 ${newCount} 个新任务 (已占用)`, 'success');
        } else {
          addLog('📭 没有新任务');
        }

        await saveTaskQueue();
        renderTaskList();
      } else if (data && data.success) {
        addLog('📭 没有待处理任务');
      } else {
        addLog(`❌ 拉取失败: ${data?.error || '未知错误'}`, 'error');
      }
    } catch (err) {
      addLog(`❌ 拉取异常: ${err.message}`, 'error');
      console.error('[Panel] 拉取异常:', err);
    }

    btnFetchTasks.textContent = '🔄 拉取任务';
    btnFetchTasks.disabled = false;
  }

  // 初始化加载任务队列，完成后自动连接 SSE + 自动启动流水线
  loadTaskQueue().then(() => {
    renderTaskList();
    // 自动连接 SSE (API 地址存在时)
    const apiBaseUrl = apiUrlInput.value.trim();
    if (apiBaseUrl) {
      btnSSEToggle.classList.add('active');
      startSSE();
      addLog('📡 自动连接 SSE...');
      // 自动启动流水线监听
      setTimeout(() => {
        if (!isAutoExecuting) {
          btnAutoExec.click();
          addLog('🤖 已自动启动流水线执行');
        }
      }, 2000);
    }
  });
})();
