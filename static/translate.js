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

    // Match by name+model rather than id: ids are list positions and shift when a profile is deleted.
    var match = profiles.find(function (profile) { return profileKey(profile) === stored; });
    if (match) return match.id;

    return profiles.length > 0 ? profiles[0].id : '';
  }

  function storeProfileId(profileId) {
    var profile = getProfiles().find(function (item) { return item.id === profileId; });
    if (!profile) return;
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, profileKey(profile));
    } catch (error) {
      // Local storage is optional.
    }
  }

  function profileKey(profile) {
    return (profile.name || '') + '\u0000' + (profile.model || '');
  }

  function profileLabel(profile) {
    if (!profile) return 'No API profile';
    var name = profile.name || 'Unnamed profile';
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
    clone.querySelectorAll('.translate-cn-toolbar, .translate-cn-result, .translate-cn-immersive').forEach(function (element) {
      element.remove();
    });

    return clone.innerHTML.trim();
  }

  var BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';
  var PARAGRAPH_SEPARATOR = '\n\n%%\n\n';
  var MAX_BATCH_BLOCKS = 8;
  var MAX_BATCH_CHARS = 6000;
  var MAX_CONCURRENT_BATCHES = 3;

  function blockSourceHtml(element) {
    var clone = element.cloneNode(true);
    clone.querySelectorAll('.translate-cn-immersive').forEach(function (node) { node.remove(); });
    if (clone.textContent.trim() === '') return '';
    return clone.innerHTML.trim();
  }

  function collectTranslatableBlocks(container) {
    var blocks = [];
    container.querySelectorAll(BLOCK_SELECTOR).forEach(function (element) {
      if (element.closest('.translate-cn-toolbar, .translate-cn-result, .translate-cn-immersive')) return;
      // Keep leaf blocks only: a blockquote or li wrapping other blocks is covered by its children.
      if (element.querySelector(BLOCK_SELECTOR)) return;
      if (blockSourceHtml(element) === '') return;
      blocks.push(element);
    });

    return blocks;
  }

  function splitTranslations(text) {
    return String(text)
      .split(/\s*%%\s*/)
      .map(function (part) { return part.trim(); })
      .filter(function (part) { return part !== ''; });
  }

  function clearImmersive(container) {
    container.querySelectorAll('.translate-cn-immersive').forEach(function (node) { node.remove(); });
  }

  function injectTranslation(block, html, profileId) {
    var target = document.createElement('span');
    target.className = 'translate-cn-immersive';
    target.dataset.profileId = profileId;
    target.innerHTML = html;
    block.appendChild(target);
  }

  function batchBlocks(blocks) {
    var batches = [];
    var current = [];
    var chars = 0;

    blocks.forEach(function (block) {
      var length = blockSourceHtml(block).length;
      if (current.length > 0 && (current.length >= MAX_BATCH_BLOCKS || chars + length > MAX_BATCH_CHARS)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(block);
      chars += length;
    });
    if (current.length > 0) batches.push(current);

    return batches;
  }

  function createProfileSelect(profiles) {
    var select = document.createElement('select');
    select.className = 'translate-cn-profile-select';
    select.setAttribute('aria-label', 'Select the API profile used for translation and summary');
    select.title = 'Select API endpoint and model';

    if (profiles.length === 0) {
      var emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'No API profile';
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
    var translateButton = createButton('translate-cn-button', 'Translate', 'Translate the article with the selected API profile');
    var summaryButton = createButton('translate-cn-summary-button', 'Summary', 'Summarize the article with the selected API profile');
    var status = document.createElement('span');
    status.className = 'translate-cn-status';
    status.setAttribute('aria-live', 'polite');

    if (profiles.length === 0) {
      translateButton.disabled = true;
      summaryButton.disabled = true;
      status.textContent = 'Add an API profile in the extension settings first.';
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
      throw new Error(response.status === 403 ? 'Request rejected; refresh the page and try again.' : 'The server returned an unrecognized response.');
    }

    return response.json().then(function (data) {
      if (!response.ok || !data || !data.ok) {
        throw new Error(data && data.error ? data.error : 'Request failed.');
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

    entryElement.querySelectorAll('.translate-cn-result, .translate-cn-immersive').forEach(function (result) {
      if (result.dataset.profileId !== select.value) result.hidden = true;
    });

    var profile = selectedProfile(toolbar);
    setStatus(toolbar.querySelector('.translate-cn-status'), 'Switched to: ' + profile.label, '');
  }

  function findResultElement(toolbar, entryElement, action) {
    return entryElement.querySelector(
      '.translate-cn-result[data-entry-id="' + toolbar.dataset.entryId + '"][data-result-type="' + action + '"]'
    );
  }

  function runSummary(toolbar, entryElement, profile, statusElement) {
    var resultElement = findResultElement(toolbar, entryElement, 'summary');

    if (resultElement && resultElement.dataset.state === 'done' && resultElement.dataset.profileId === profile.id) {
      resultElement.hidden = !resultElement.hidden;
      return;
    }

    var contentHtml = findEntryContent(entryElement);
    if (!contentHtml) {
      setStatus(statusElement, 'No content available to summarize.', 'error');
      return;
    }

    var csrfToken = getCsrfToken();
    if (!csrfToken) {
      setStatus(statusElement, 'Missing CSRF token; refresh the page and try again.', 'error');
      return;
    }

    setToolbarLoading(toolbar, true);
    setStatus(statusElement, 'Summarizing (' + profile.label + ')…', 'loading');

    requestAction(getEndpoint(toolbar, 'summary'), contentHtml, csrfToken, profile.id)
      .then(function (data) {
        if (resultElement) {
          resultElement.innerHTML = data.translated_html;
          resultElement.hidden = false;
          resultElement.dataset.state = 'done';
          resultElement.dataset.profileId = profile.id;
        }
        setStatus(statusElement, 'Summary ready (' + profile.label + ').', 'done');
      })
      .catch(function (error) {
        setStatus(statusElement, error.message || 'Failed to generate summary.', 'error');
      })
      .finally(function () {
        setToolbarLoading(toolbar, false);
      });
  }

  function runImmersiveTranslate(toolbar, entryElement, profile, statusElement) {
    var container = findContentContainer(entryElement);
    if (!container) {
      setStatus(statusElement, 'No content available to translate.', 'error');
      return;
    }

    var existing = container.querySelectorAll('.translate-cn-immersive');
    var sameProfile = existing.length > 0 && existing[0].dataset.profileId === profile.id;
    if (sameProfile && toolbar.dataset.translateComplete === profile.id) {
      existing.forEach(function (node) { node.hidden = !node.hidden; });
      return;
    }
    if (existing.length > 0 && !sameProfile) {
      clearImmersive(container);
    }

    var allBlocks = collectTranslatableBlocks(container);
    if (allBlocks.length === 0) {
      runLegacyTranslate(toolbar, entryElement, profile, statusElement);
      return;
    }

    // After a partial failure, only the still-untranslated blocks are requested again.
    var blocks = allBlocks.filter(function (block) {
      return !block.querySelector('.translate-cn-immersive');
    });
    if (blocks.length === 0) {
      toolbar.dataset.translateComplete = profile.id;
      container.querySelectorAll('.translate-cn-immersive').forEach(function (node) { node.hidden = false; });
      setStatus(statusElement, 'Translation complete (' + profile.label + ').', 'done');
      return;
    }

    var csrfToken = getCsrfToken();
    if (!csrfToken) {
      setStatus(statusElement, 'Missing CSRF token; refresh the page and try again.', 'error');
      return;
    }

    var batches = batchBlocks(blocks);
    var queue = batches.map(function (batch, index) { return { batch: batch, index: index }; });
    var results = new Array(batches.length);
    var nextToRender = 0;
    var done = 0;
    var failures = 0;

    delete toolbar.dataset.translateComplete;
    setToolbarLoading(toolbar, true);
    setStatus(statusElement, 'Translating (' + profile.label + ')… 0/' + batches.length, 'loading');

    // Batches run concurrently but render strictly in document order:
    // batch N is injected only once every batch before it has been rendered.
    function flushRenderedBatches() {
      while (nextToRender < batches.length && results[nextToRender] !== undefined) {
        var parts = results[nextToRender];
        var batch = batches[nextToRender];
        if (parts !== null) {
          if (parts.length === batch.length) {
            batch.forEach(function (block, index) {
              injectTranslation(block, parts[index], profile.id);
            });
          } else {
            // The model merged or split paragraphs: keep the content visible on the batch's first block.
            injectTranslation(batch[0], parts.join('<br>'), profile.id);
          }
        }
        nextToRender += 1;
      }
    }

    function translateNextBatch() {
      var item = queue.shift();
      if (!item) return Promise.resolve();

      var contentHtml = item.batch.map(blockSourceHtml).join(PARAGRAPH_SEPARATOR);
      return requestAction(getEndpoint(toolbar, 'translate'), contentHtml, csrfToken, profile.id)
        .then(function (data) {
          results[item.index] = splitTranslations(data.translated_html);
          done += 1;
          setStatus(statusElement, 'Translating (' + profile.label + ')… ' + done + '/' + batches.length, 'loading');
        })
        .catch(function () {
          results[item.index] = null;
          failures += 1;
        })
        .then(function () {
          flushRenderedBatches();
          return translateNextBatch();
        });
    }

    var workers = [];
    for (var i = 0; i < Math.min(MAX_CONCURRENT_BATCHES, batches.length); i += 1) {
      workers.push(translateNextBatch());
    }

    Promise.all(workers)
      .then(function () {
        if (failures > 0) {
          setStatus(statusElement, failures + ' of ' + batches.length + ' parts failed; click Translate to retry them.', 'error');
        } else {
          toolbar.dataset.translateComplete = profile.id;
          setStatus(statusElement, 'Translation complete (' + profile.label + ').', 'done');
        }
      })
      .finally(function () {
        setToolbarLoading(toolbar, false);
      });
  }

  function runLegacyTranslate(toolbar, entryElement, profile, statusElement) {
    var resultElement = findResultElement(toolbar, entryElement, 'translate');

    if (resultElement && resultElement.dataset.state === 'done' && resultElement.dataset.profileId === profile.id) {
      resultElement.hidden = !resultElement.hidden;
      return;
    }

    var contentHtml = findEntryContent(entryElement);
    if (!contentHtml) {
      setStatus(statusElement, 'No content available to translate.', 'error');
      return;
    }

    var csrfToken = getCsrfToken();
    if (!csrfToken) {
      setStatus(statusElement, 'Missing CSRF token; refresh the page and try again.', 'error');
      return;
    }

    setToolbarLoading(toolbar, true);
    setStatus(statusElement, 'Translating (' + profile.label + ')…', 'loading');

    requestAction(getEndpoint(toolbar, 'translate'), contentHtml, csrfToken, profile.id)
      .then(function (data) {
        if (resultElement) {
          resultElement.innerHTML = data.translated_html;
          resultElement.hidden = false;
          resultElement.dataset.state = 'done';
          resultElement.dataset.profileId = profile.id;
        }
        setStatus(statusElement, 'Translation complete (' + profile.label + ').', 'done');
      })
      .catch(function (error) {
        setStatus(statusElement, error.message || 'Translation failed.', 'error');
      })
      .finally(function () {
        setToolbarLoading(toolbar, false);
      });
  }

  function handleClick(event) {
    var button = event.target.closest('.translate-cn-button, .translate-cn-summary-button');
    if (!button) return;

    var toolbar = button.closest('.translate-cn-toolbar');
    var entryElement = button.closest('.entry') || button.closest('.flux');
    if (!toolbar || !entryElement || toolbar.dataset.loading === '1') return;

    var profile = selectedProfile(toolbar);
    var statusElement = toolbar.querySelector('.translate-cn-status');
    if (!profile.id) {
      setStatus(statusElement, 'Select a valid API profile first.', 'error');
      return;
    }

    if (button.classList.contains('translate-cn-summary-button')) {
      runSummary(toolbar, entryElement, profile, statusElement);
    } else {
      runImmersiveTranslate(toolbar, entryElement, profile, statusElement);
    }
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
