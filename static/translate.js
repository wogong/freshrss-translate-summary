(function () {
  'use strict';

  var isBound = false;
  var observer = null;
  var PROFILE_STORAGE_KEY = 'freshrss-translate-summary-profile';

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback);
    } else {
      callback();
    }
  }

  function getExtensionConfig() {
    var candidates = [
      window.extensions && window.extensions.translateCn,
      window.context && window.context.translateCn,
      window.context && window.context.extensions && window.context.extensions.translateCn
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && typeof candidates[i] === 'object') {
        return candidates[i];
      }
    }

    return {};
  }

  function getProfiles() {
    var profiles = getExtensionConfig().profiles;
    if (!Array.isArray(profiles)) return [];

    return profiles.filter(function (profile) {
      return profile && typeof profile.id === 'string';
    });
  }

  function getStoredProfileId(profiles) {
    var stored = '';
    try {
      stored = window.localStorage.getItem(PROFILE_STORAGE_KEY) || '';
    } catch (error) {
      stored = '';
    }

    if (profiles.some(function (profile) { return profile.id === stored; })) {
      return stored;
    }

    return profiles.length > 0 ? profiles[0].id : '';
  }

  function storeProfileId(profileId) {
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
    } catch (error) {
      // Local storage is optional.
    }
  }

  function profileLabel(profile) {
    if (!profile) return '未配置 API';
    var name = profile.name || '未命名配置';
    return profile.model ? name + ' · ' + profile.model : name;
  }

  function getEndpoint(toolbar, action) {
    if (toolbar) {
      if (action === 'summary' && toolbar.dataset.summaryEndpoint) return toolbar.dataset.summaryEndpoint;
      if (action === 'translate' && toolbar.dataset.translateEndpoint) return toolbar.dataset.translateEndpoint;
    }

    var config = getExtensionConfig();
    if (action === 'summary' && config.summaryEndpoint) return config.summaryEndpoint;
    if (action === 'translate' && config.translateEndpoint) return config.translateEndpoint;

    return action === 'summary'
      ? '?c=TranslateSummary&a=summary'
      : '?c=TranslateSummary&a=translate';
  }

  function getCsrfToken() {
    if (typeof context !== 'undefined' && context && context.csrf) return context.csrf;
    if (window.context && window.context.csrf) return window.context.csrf;

    var config = getExtensionConfig();
    if (config.csrf) return config.csrf;

    var input = document.querySelector('input[name="_csrf"]');
    return input && input.value ? input.value : '';
  }

  function findContentContainer(entryElement) {
    if (!entryElement) return null;

    var selectors = [
      '.text',
      '.content',
      '.entry-content',
      '.entry_content',
      '.item-content',
      '.item-content-body',
      '.article',
      '.flux_content .text',
      '.flux_content',
      'article'
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var element = entryElement.querySelector(selectors[i]);
      if (element) return element;
    }

    return null;
  }

  function findEntryContent(entryElement) {
    var contentElement = findContentContainer(entryElement);
    if (!contentElement) return '';

    var clone = contentElement.cloneNode(true);
    clone.querySelectorAll('.translate-cn-toolbar, .translate-cn-result').forEach(function (element) {
      element.remove();
    });

    return clone.innerHTML.trim();
  }

  function createProfileSelect(profiles) {
    var select = document.createElement('select');
    select.className = 'translate-cn-profile-select';
    select.setAttribute('aria-label', '选择翻译与摘要使用的 API 配置');
    select.title = '选择 API 地址和模型';

    if (profiles.length === 0) {
      var emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '未配置 API';
      select.appendChild(emptyOption);
      select.disabled = true;
      return select;
    }

    var selectedId = getStoredProfileId(profiles);
    profiles.forEach(function (profile) {
      var option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profileLabel(profile);
      option.selected = profile.id === selectedId;
      select.appendChild(option);
    });

    select.disabled = profiles.length <= 1;
    return select;
  }

  function createButton(className, label, title) {
    var button = document.createElement('button');
    button.className = 'btn ' + className;
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    return button;
  }

  function ensureToolbar(entryElement) {
    if (!entryElement || entryElement.querySelector('.translate-cn-toolbar')) return;

    var container = findContentContainer(entryElement);
    if (!container) return;

    var profiles = getProfiles();
    var config = getExtensionConfig();
    var entryId = entryElement.dataset.entry || entryElement.getAttribute('data-entry') || entryElement.id || '';
    var toolbar = document.createElement('div');
    toolbar.className = 'translate-cn-toolbar';
    toolbar.dataset.entryId = entryId;
    toolbar.dataset.translateEndpoint = config.translateEndpoint || '?c=TranslateSummary&a=translate';
    toolbar.dataset.summaryEndpoint = config.summaryEndpoint || '?c=TranslateSummary&a=summary';

    var select = createProfileSelect(profiles);
    var translateButton = createButton('translate-cn-button', '翻译', '使用所选 API 配置翻译文章');
    var summaryButton = createButton('translate-cn-summary-button', '摘要', '使用所选 API 配置生成摘要');
    var status = document.createElement('span');
    status.className = 'translate-cn-status';
    status.setAttribute('aria-live', 'polite');

    if (profiles.length === 0) {
      translateButton.disabled = true;
      summaryButton.disabled = true;
      status.textContent = '请先在扩展设置中添加 API 配置。';
      status.dataset.state = 'error';
    }

    toolbar.appendChild(select);
    toolbar.appendChild(translateButton);
    toolbar.appendChild(summaryButton);
    toolbar.appendChild(status);

    var translationResult = document.createElement('div');
    translationResult.className = 'translate-cn-result translate-cn-result-translate';
    translationResult.dataset.entryId = entryId;
    translationResult.dataset.resultType = 'translate';
    translationResult.hidden = true;

    var summaryResult = document.createElement('div');
    summaryResult.className = 'translate-cn-result translate-cn-result-summary';
    summaryResult.dataset.entryId = entryId;
    summaryResult.dataset.resultType = 'summary';
    summaryResult.hidden = true;

    container.insertBefore(toolbar, container.firstChild);
    container.insertBefore(translationResult, toolbar.nextSibling);
    container.insertBefore(summaryResult, translationResult.nextSibling);
  }

  function ensureToolbars(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && (root.matches('.flux') || root.matches('.entry'))) ensureToolbar(root);
    root.querySelectorAll('.flux, .entry').forEach(ensureToolbar);
  }

  function setStatus(element, message, state) {
    if (!element) return;
    element.textContent = message || '';
    element.dataset.state = state || '';
  }

  function setToolbarLoading(toolbar, isLoading) {
    if (!toolbar) return;
    toolbar.dataset.loading = isLoading ? '1' : '';
    toolbar.querySelectorAll('button, select').forEach(function (control) {
      if (control.classList.contains('translate-cn-profile-select') && control.options.length <= 1) {
        control.disabled = true;
      } else {
        control.disabled = isLoading;
      }
    });
  }

  function parseResponse(response) {
    var contentType = response.headers.get('Content-Type') || '';
    if (contentType.indexOf('application/json') === -1) {
      throw new Error(response.status === 403 ? '请求被拒绝，请刷新页面后重试。' : '服务器返回了无法识别的响应。');
    }

    return response.json().then(function (data) {
      if (!response.ok || !data || !data.ok) {
        throw new Error(data && data.error ? data.error : '请求失败。');
      }
      return data;
    });
  }

  function requestAction(endpoint, contentHtml, csrfToken, profileId) {
    var formData = new URLSearchParams();
    formData.set('content_html', contentHtml);
    formData.set('profile_id', profileId);
    formData.set('ajax', '1');
    formData.set('_csrf', csrfToken);

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin',
      body: formData.toString()
    }).then(parseResponse);
  }

  function selectedProfile(toolbar) {
    var select = toolbar.querySelector('.translate-cn-profile-select');
    var profiles = getProfiles();
    var profileId = select ? select.value : '';
    var profile = profiles.find(function (item) { return item.id === profileId; });

    return { id: profileId, label: profileLabel(profile) };
  }

  function handleProfileChange(event) {
    var select = event.target.closest('.translate-cn-profile-select');
    if (!select) return;

    storeProfileId(select.value);
    var toolbar = select.closest('.translate-cn-toolbar');
    var entryElement = select.closest('.entry') || select.closest('.flux');
    if (!toolbar || !entryElement) return;

    entryElement.querySelectorAll('.translate-cn-result').forEach(function (result) {
      if (result.dataset.profileId !== select.value) result.hidden = true;
    });

    var profile = selectedProfile(toolbar);
    setStatus(toolbar.querySelector('.translate-cn-status'), '已切换到：' + profile.label, '');
  }

  function handleClick(event) {
    var button = event.target.closest('.translate-cn-button, .translate-cn-summary-button');
    if (!button) return;

    var toolbar = button.closest('.translate-cn-toolbar');
    var entryElement = button.closest('.entry') || button.closest('.flux');
    if (!toolbar || !entryElement || toolbar.dataset.loading === '1') return;

    var profile = selectedProfile(toolbar);
    if (!profile.id) {
      setStatus(toolbar.querySelector('.translate-cn-status'), '请先选择有效的 API 配置。', 'error');
      return;
    }

    var isSummary = button.classList.contains('translate-cn-summary-button');
    var action = isSummary ? 'summary' : 'translate';
    var statusElement = toolbar.querySelector('.translate-cn-status');
    var resultElement = entryElement.querySelector(
      '.translate-cn-result[data-entry-id="' + toolbar.dataset.entryId + '"][data-result-type="' + action + '"]'
    );

    if (resultElement && resultElement.dataset.state === 'done' && resultElement.dataset.profileId === profile.id) {
      resultElement.hidden = !resultElement.hidden;
      return;
    }

    var contentHtml = findEntryContent(entryElement);
    if (!contentHtml) {
      setStatus(statusElement, isSummary ? '没有可生成摘要的内容。' : '没有可翻译的内容。', 'error');
      return;
    }

    var csrfToken = getCsrfToken();
    if (!csrfToken) {
      setStatus(statusElement, '缺少 CSRF 令牌，请刷新页面后重试。', 'error');
      return;
    }

    setToolbarLoading(toolbar, true);
    setStatus(statusElement, (isSummary ? '正在生成摘要' : '正在翻译') + '（' + profile.label + '）…', 'loading');

    requestAction(getEndpoint(toolbar, action), contentHtml, csrfToken, profile.id)
      .then(function (data) {
        if (resultElement) {
          resultElement.innerHTML = data.translated_html;
          resultElement.hidden = false;
          resultElement.dataset.state = 'done';
          resultElement.dataset.profileId = profile.id;
        }
        setStatus(statusElement, (isSummary ? '摘要已生成' : '翻译已完成') + '（' + profile.label + '）。', 'done');
      })
      .catch(function (error) {
        setStatus(statusElement, error.message || (isSummary ? '生成摘要失败。' : '翻译失败。'), 'error');
      })
      .finally(function () {
        setToolbarLoading(toolbar, false);
      });
  }

  function bind() {
    if (isBound) return;
    isBound = true;

    ensureToolbars(document);
    document.body.addEventListener('click', handleClick);
    document.body.addEventListener('change', handleProfileChange);

    var streamRoot = document.getElementById('global') || document.body;
    observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node && node.nodeType === 1) ensureToolbars(node);
        });
      });
    });
    observer.observe(streamRoot, { childList: true, subtree: true });
  }

  ready(bind);
  document.addEventListener('freshrss:globalContextLoaded', function () {
    ensureToolbars(document);
    bind();
  });
})();
