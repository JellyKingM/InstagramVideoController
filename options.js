const STORAGE_KEYS = {
    backwardInterval: 'backwardIntervalV',
    forwardInterval: 'forwardIntervalV',
    nativeControlsEnabled: 'nativeControlsEnabledV',
    volumeControlEnabled: 'volumeControlEnabledV',
    muteControlEnabled: 'muteControlEnabledV',
    playbackRateControlEnabled: 'playbackRateControlEnabledV',
    keyboardShortcutsEnabled: 'keyboardShortcutsEnabledV',
    squareVideoContainerEnabled: 'squareVideoContainerEnabledV',
    standalonePostLayoutEnabled: 'standalonePostLayoutEnabledV',
    hideInstagramVideoPlayerEnabled: 'hideInstagramVideoPlayerEnabledV',
    autoScanEnabled: 'autoScanEnabledV',
    sideBoxEnabled: 'sideBoxEnabledV',
    sideBoxInfoEnabled: 'sideBoxInfoEnabledV',
    sideBoxControlsEnabled: 'sideBoxControlsEnabledV',
    sideBoxRestoreButtonEnabled: 'sideBoxRestoreButtonEnabledV',
    sideBoxDonatePromptEnabled: 'sideBoxDonatePromptEnabledV',
    moveInfoToSideBoxEnabled: 'moveInfoToSideBoxEnabledV',
    hideMovedInfoOverlayEnabled: 'hideMovedInfoOverlayEnabledV',
    sideBoxVisible: 'sideBoxVisibleV',
    hideReelClickCover: 'hideReelClickCoverV',
    sideBoxColor: 'sideBoxColorV',
    debugRemoteVisible: 'debugRemoteVisibleV',
    debugLogVisible: 'debugLogVisibleV',
    debugLogFontSize: 'debugLogFontSizeV',
    debugLogFontFamily: 'debugLogFontFamilyV',
    debugLogTheme: 'debugLogThemeV'
};

const DEFAULTS = {
    [STORAGE_KEYS.backwardInterval]: 10,
    [STORAGE_KEYS.forwardInterval]: 10,
    [STORAGE_KEYS.nativeControlsEnabled]: true,
    [STORAGE_KEYS.volumeControlEnabled]: true,
    [STORAGE_KEYS.muteControlEnabled]: true,
    [STORAGE_KEYS.playbackRateControlEnabled]: true,
    [STORAGE_KEYS.keyboardShortcutsEnabled]: true,
    [STORAGE_KEYS.squareVideoContainerEnabled]: true,
    [STORAGE_KEYS.standalonePostLayoutEnabled]: true,
    [STORAGE_KEYS.hideInstagramVideoPlayerEnabled]: true,
    [STORAGE_KEYS.autoScanEnabled]: true,
    [STORAGE_KEYS.sideBoxEnabled]: true,
    [STORAGE_KEYS.sideBoxInfoEnabled]: true,
    [STORAGE_KEYS.sideBoxControlsEnabled]: true,
    [STORAGE_KEYS.sideBoxRestoreButtonEnabled]: true,
    [STORAGE_KEYS.sideBoxDonatePromptEnabled]: true,
    [STORAGE_KEYS.moveInfoToSideBoxEnabled]: true,
    [STORAGE_KEYS.hideMovedInfoOverlayEnabled]: true,
    [STORAGE_KEYS.sideBoxVisible]: true,
    [STORAGE_KEYS.hideReelClickCover]: true,
    [STORAGE_KEYS.sideBoxColor]: '#121212',
    [STORAGE_KEYS.debugRemoteVisible]: false,
    [STORAGE_KEYS.debugLogVisible]: false,
    [STORAGE_KEYS.debugLogFontSize]: 10,
    [STORAGE_KEYS.debugLogFontFamily]: 'Consolas, monospace',
    [STORAGE_KEYS.debugLogTheme]: 'dark'
};

const backwardInput = document.getElementById('backwardInterval');
const forwardInput = document.getElementById('forwardInterval');
const nativeControlsCheckbox = document.getElementById('nativeControlsEnabled');
const volumeControlCheckbox = document.getElementById('volumeControlEnabled');
const muteControlCheckbox = document.getElementById('muteControlEnabled');
const playbackRateControlCheckbox = document.getElementById('playbackRateControlEnabled');
const keyboardShortcutsCheckbox = document.getElementById('keyboardShortcutsEnabled');
const squareVideoContainerCheckbox = document.getElementById('squareVideoContainerEnabled');
const standalonePostLayoutCheckbox = document.getElementById('standalonePostLayoutEnabled');
const hideInstagramVideoPlayerCheckbox = document.getElementById('hideInstagramVideoPlayerEnabled');
const autoScanCheckbox = document.getElementById('autoScanEnabled');
const sideBoxEnabledCheckbox = document.getElementById('sideBoxEnabled');
const sideBoxInfoCheckbox = document.getElementById('sideBoxInfoEnabled');
const sideBoxControlsCheckbox = document.getElementById('sideBoxControlsEnabled');
const sideBoxRestoreButtonCheckbox = document.getElementById('sideBoxRestoreButtonEnabled');
const sideBoxDonatePromptCheckbox = document.getElementById('sideBoxDonatePromptEnabled');
const moveInfoToSideBoxCheckbox = document.getElementById('moveInfoToSideBoxEnabled');
const hideMovedInfoOverlayCheckbox = document.getElementById('hideMovedInfoOverlayEnabled');
const hideReelClickCoverCheckbox = document.getElementById('hideReelClickCover');
const sideBoxColorInput = document.getElementById('sideBoxColor');
const debugLogVisibleCheckbox = document.getElementById('debugLogVisible');
const debugLogFontSizeInput = document.getElementById('debugLogFontSize');
const debugLogFontFamilySelect = document.getElementById('debugLogFontFamily');
const debugLogThemeSelect = document.getElementById('debugLogTheme');
const statusEl = document.getElementById('status');

function t(key, fallback) {
    const message = chrome.i18n.getMessage(key);
    return message || fallback;
}

function clampNumber(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function setStatus(message) {
    statusEl.textContent = message;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
        statusEl.textContent = '';
    }, 1400);
}

function save(values) {
    chrome.storage.local.set(values, () => {
        setStatus(t('saved', 'Saved'));
    });
}

function bindLabels() {
    document.getElementById('pageTitle').textContent = t('panelTitle', 'Instagram Video Controller');
    document.getElementById('developer').textContent = t('developerLink', 'Developer Page');
    document.getElementById('donate').textContent = t('donate', 'Donate to Developer');

    const sectionTitles = document.querySelectorAll('.section-title');
    [
        ['sectionBasic', 'Basic'],
        ['sectionVideoBehavior', 'Video Behavior'],
        ['sectionSideBox', 'Side Box'],
        ['sectionDebugLog', 'Debug Log']
    ].forEach(([key, fallback], index) => {
        if (sectionTitles[index]) sectionTitles[index].textContent = t(key, fallback);
    });

    [
        ['nativeControlsEnabled', 'nativeControlsLabel', 'Native video controls', 'nativeControlsHint', 'Show Instagram video controls on the video itself.'],
        ['backwardInterval', 'backwardIntervalLabel', 'Back seconds', 'backwardIntervalHint', 'Step size for the back button.'],
        ['forwardInterval', 'forwardIntervalLabel', 'Forward seconds', 'forwardIntervalHint', 'Step size for the forward button.'],
        ['volumeControlEnabled', 'volumeControlLabel', 'Volume control', 'volumeControlHint', 'Apply the extension volume value to detected videos.'],
        ['muteControlEnabled', 'muteControlLabel', 'Mute control', 'muteControlHint', 'Apply mute and unmute state from the extension.'],
        ['playbackRateControlEnabled', 'playbackRateControlLabel', 'Playback speed control', 'playbackRateControlHint', 'Apply the extension playback speed to videos.'],
        ['keyboardShortcutsEnabled', 'keyboardShortcutsLabel', 'Keyboard shortcuts', 'keyboardShortcutsHint', 'Enable M, comma, period, and B shortcuts.'],
        ['squareVideoContainerEnabled', 'squareVideoContainerLabel', 'Square video container', 'squareVideoContainerHint', 'Remove rounded corners from the video container.'],
        ['standalonePostLayoutEnabled', 'standalonePostLayoutLabel', 'Standalone post layout', 'standalonePostLayoutHint', 'Widen standalone post layout for the side box.'],
        ['hideInstagramVideoPlayerEnabled', 'hideInstagramVideoPlayerLabel', 'Hide Instagram video player layer', 'hideInstagramVideoPlayerHint', "Hide Instagram's own Video player overlay elements."],
        ['autoScanEnabled', 'autoScanLabel', 'Automatic rescanning', 'autoScanHint', 'Keep scanning the page as Instagram changes videos.'],
        ['sideBoxEnabled', 'sideBoxEnabledLabel', 'Create side box', 'sideBoxEnabledHint', 'Turns off every side-box feature below when disabled.'],
        ['sideBoxInfoEnabled', 'sideBoxInfoLabel', 'Create info area', 'sideBoxInfoHint', 'Add the upper area that receives Instagram post data.'],
        ['moveInfoToSideBoxEnabled', 'moveInfoToSideBoxLabel', 'Move post info into side box', 'moveInfoToSideBoxHint', 'Move captions and related info from Instagram overlays.'],
        ['hideMovedInfoOverlayEnabled', 'hideMovedInfoOverlayLabel', 'Hide moved-info overlays', 'hideMovedInfoOverlayHint', 'Hide original overlays after moving info into the box.'],
        ['sideBoxControlsEnabled', 'sideBoxControlsLabel', 'Create control buttons', 'sideBoxControlsHint', 'Add play, mute, seek, speed, volume, and donate controls.'],
        ['sideBoxRestoreButtonEnabled', 'sideBoxRestoreButtonLabel', 'Create restore button', 'sideBoxRestoreButtonHint', 'Show a button to bring back the side box after hiding it.'],
        ['sideBoxDonatePromptEnabled', 'sideBoxDonatePromptLabel', 'Donation prompt', 'sideBoxDonatePromptHint', 'Allow the side box to show the occasional support prompt.'],
        ['hideReelClickCover', 'hideReelClickCoverLabel', 'Hide Reels click cover', 'hideReelClickCoverHint', 'Hide the transparent click layer covering Reels videos.'],
        ['sideBoxColor', 'sideBoxColorLabel', 'Side box color', 'sideBoxColorHint', 'Background color for the controller box.'],
        ['debugLogVisible', 'debugLogVisibleLabel', 'Developer debug log', 'debugLogVisibleHint', 'Show page logs in the top-right corner of Instagram.'],
        ['debugLogFontSize', 'debugLogFontSizeLabel', 'Font size', 'debugLogFontSizeHint', 'Default is 10px.'],
        ['debugLogFontFamily', 'debugLogFontFamilyLabel', 'Font', 'debugLogFontFamilyHint', 'Choose a readable debug font.'],
        ['debugLogTheme', 'debugLogThemeLabel', 'Color theme', 'debugLogThemeHint', 'Pick contrast for the page overlay.']
    ].forEach(([id, labelKey, labelFallback, hintKey, hintFallback]) => {
        const control = document.getElementById(id);
        const row = control && control.closest('.option-row');
        if (!row) return;
        const label = row.querySelector('.label strong');
        const hint = row.querySelector('.label span');
        if (label) label.textContent = t(labelKey, labelFallback);
        if (hint) hint.textContent = t(hintKey, hintFallback);
    });

    const themeLabels = {
        dark: t('debugLogThemeDark', 'Dark'),
        light: t('debugLogThemeLight', 'Light'),
        signal: t('debugLogThemeSignal', 'Signal')
    };
    Array.from(debugLogThemeSelect.options).forEach(option => {
        option.textContent = themeLabels[option.value] || option.textContent;
    });
}

function bindLinks() {
    document.getElementById('developer').addEventListener('click', () => {
        chrome.tabs.create({ url: IVC_SHARED.LINKS.developer });
    });

    document.getElementById('donate').addEventListener('click', () => {
        chrome.tabs.create({ url: IVC_SHARED.LINKS.donate });
    });
}

function setChildrenDisabled(parentId, disabled) {
    document.querySelectorAll(`[data-parent="${parentId}"]`).forEach(row => {
        row.classList.toggle('disabled', disabled);
        row.querySelectorAll('input, select, button').forEach(control => {
            control.disabled = disabled;
        });
    });
}

function updateDependencyState() {
    setChildrenDisabled('sideBoxEnabled', !sideBoxEnabledCheckbox.checked);
    document.querySelectorAll('[data-side-info-child="true"]').forEach(row => {
        const disabled = !sideBoxEnabledCheckbox.checked || !sideBoxInfoCheckbox.checked;
        row.classList.toggle('disabled', disabled);
        row.querySelectorAll('input, select, button').forEach(control => {
            control.disabled = disabled;
        });
    });
    setChildrenDisabled('debugLogVisible', !debugLogVisibleCheckbox.checked);
}

function loadValues(result) {
    backwardInput.value = String(clampNumber(result[STORAGE_KEYS.backwardInterval], 1, 60, 10));
    forwardInput.value = String(clampNumber(result[STORAGE_KEYS.forwardInterval], 1, 60, 10));
    nativeControlsCheckbox.checked = result[STORAGE_KEYS.nativeControlsEnabled] !== false;
    volumeControlCheckbox.checked = result[STORAGE_KEYS.volumeControlEnabled] !== false;
    muteControlCheckbox.checked = result[STORAGE_KEYS.muteControlEnabled] !== false;
    playbackRateControlCheckbox.checked = result[STORAGE_KEYS.playbackRateControlEnabled] !== false;
    keyboardShortcutsCheckbox.checked = result[STORAGE_KEYS.keyboardShortcutsEnabled] !== false;
    squareVideoContainerCheckbox.checked = result[STORAGE_KEYS.squareVideoContainerEnabled] !== false;
    standalonePostLayoutCheckbox.checked = result[STORAGE_KEYS.standalonePostLayoutEnabled] !== false;
    hideInstagramVideoPlayerCheckbox.checked = result[STORAGE_KEYS.hideInstagramVideoPlayerEnabled] !== false;
    autoScanCheckbox.checked = result[STORAGE_KEYS.autoScanEnabled] !== false;
    sideBoxEnabledCheckbox.checked = result[STORAGE_KEYS.sideBoxEnabled] !== false;
    sideBoxInfoCheckbox.checked = result[STORAGE_KEYS.sideBoxInfoEnabled] !== false;
    sideBoxControlsCheckbox.checked = result[STORAGE_KEYS.sideBoxControlsEnabled] !== false;
    sideBoxRestoreButtonCheckbox.checked = result[STORAGE_KEYS.sideBoxRestoreButtonEnabled] !== false;
    sideBoxDonatePromptCheckbox.checked = result[STORAGE_KEYS.sideBoxDonatePromptEnabled] !== false;
    moveInfoToSideBoxCheckbox.checked = result[STORAGE_KEYS.moveInfoToSideBoxEnabled] !== false;
    hideMovedInfoOverlayCheckbox.checked = result[STORAGE_KEYS.hideMovedInfoOverlayEnabled] !== false;
    hideReelClickCoverCheckbox.checked = result[STORAGE_KEYS.hideReelClickCover] !== false;
    sideBoxColorInput.value = result[STORAGE_KEYS.sideBoxColor] || DEFAULTS[STORAGE_KEYS.sideBoxColor];
    debugLogVisibleCheckbox.checked = result[STORAGE_KEYS.debugLogVisible] === true;
    debugLogFontSizeInput.value = String(clampNumber(result[STORAGE_KEYS.debugLogFontSize], 8, 18, 10));
    debugLogFontFamilySelect.value = result[STORAGE_KEYS.debugLogFontFamily] || DEFAULTS[STORAGE_KEYS.debugLogFontFamily];
    debugLogThemeSelect.value = result[STORAGE_KEYS.debugLogTheme] || DEFAULTS[STORAGE_KEYS.debugLogTheme];
    updateDependencyState();
}

function bindControls() {
    backwardInput.addEventListener('change', () => {
        const value = clampNumber(backwardInput.value, 1, 60, 10);
        backwardInput.value = String(value);
        save({ [STORAGE_KEYS.backwardInterval]: value });
    });

    forwardInput.addEventListener('change', () => {
        const value = clampNumber(forwardInput.value, 1, 60, 10);
        forwardInput.value = String(value);
        save({ [STORAGE_KEYS.forwardInterval]: value });
    });

    nativeControlsCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.nativeControlsEnabled]: nativeControlsCheckbox.checked });
    });

    [
        [volumeControlCheckbox, STORAGE_KEYS.volumeControlEnabled],
        [muteControlCheckbox, STORAGE_KEYS.muteControlEnabled],
        [playbackRateControlCheckbox, STORAGE_KEYS.playbackRateControlEnabled],
        [keyboardShortcutsCheckbox, STORAGE_KEYS.keyboardShortcutsEnabled],
        [squareVideoContainerCheckbox, STORAGE_KEYS.squareVideoContainerEnabled],
        [standalonePostLayoutCheckbox, STORAGE_KEYS.standalonePostLayoutEnabled],
        [hideInstagramVideoPlayerCheckbox, STORAGE_KEYS.hideInstagramVideoPlayerEnabled],
        [autoScanCheckbox, STORAGE_KEYS.autoScanEnabled]
    ].forEach(([checkbox, key]) => {
        checkbox.addEventListener('change', () => {
            save({ [key]: checkbox.checked });
        });
    });

    sideBoxEnabledCheckbox.addEventListener('change', () => {
        updateDependencyState();
        save({
            [STORAGE_KEYS.sideBoxEnabled]: sideBoxEnabledCheckbox.checked,
            [STORAGE_KEYS.sideBoxVisible]: sideBoxEnabledCheckbox.checked
        });
    });

    sideBoxInfoCheckbox.addEventListener('change', () => {
        updateDependencyState();
        save({ [STORAGE_KEYS.sideBoxInfoEnabled]: sideBoxInfoCheckbox.checked });
    });

    sideBoxControlsCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.sideBoxControlsEnabled]: sideBoxControlsCheckbox.checked });
    });

    sideBoxRestoreButtonCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.sideBoxRestoreButtonEnabled]: sideBoxRestoreButtonCheckbox.checked });
    });

    sideBoxDonatePromptCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.sideBoxDonatePromptEnabled]: sideBoxDonatePromptCheckbox.checked });
    });

    moveInfoToSideBoxCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.moveInfoToSideBoxEnabled]: moveInfoToSideBoxCheckbox.checked });
    });

    hideMovedInfoOverlayCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.hideMovedInfoOverlayEnabled]: hideMovedInfoOverlayCheckbox.checked });
    });

    hideReelClickCoverCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.hideReelClickCover]: hideReelClickCoverCheckbox.checked });
    });

    sideBoxColorInput.addEventListener('input', () => {
        save({ [STORAGE_KEYS.sideBoxColor]: sideBoxColorInput.value });
    });

    debugLogVisibleCheckbox.addEventListener('change', () => {
        updateDependencyState();
        save({ [STORAGE_KEYS.debugLogVisible]: debugLogVisibleCheckbox.checked });
    });

    debugLogFontSizeInput.addEventListener('change', () => {
        const value = clampNumber(debugLogFontSizeInput.value, 8, 18, 10);
        debugLogFontSizeInput.value = String(value);
        save({ [STORAGE_KEYS.debugLogFontSize]: value });
    });

    debugLogFontFamilySelect.addEventListener('change', () => {
        save({ [STORAGE_KEYS.debugLogFontFamily]: debugLogFontFamilySelect.value });
    });

    debugLogThemeSelect.addEventListener('change', () => {
        save({ [STORAGE_KEYS.debugLogTheme]: debugLogThemeSelect.value });
    });
}

bindLabels();
bindLinks();
bindControls();

chrome.storage.local.get(DEFAULTS, result => {
    if (result[STORAGE_KEYS.debugRemoteVisible] === true) {
        result[STORAGE_KEYS.debugRemoteVisible] = false;
        save({ [STORAGE_KEYS.debugRemoteVisible]: false });
    }
    loadValues(result);
});
