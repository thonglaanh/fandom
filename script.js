const MAP_GEOJSON_URL = 'https://raw.githubusercontent.com/adminvsrm/gisdata/main/Vietnam%20Administrative%20Divisions%20%28Pre-2025%29%20-%20%C4%90%C6%A1n%20v%E1%BB%8B%20h%C3%A0nh%20ch%C3%ADnh%20Vi%E1%BB%87t%20Nam%20%28Tr%C6%B0%E1%BB%9Bc%202025%29/Provinces_included_Paracel_SpratlyIslands.geojson';
const MAP_GEOJSON_DATA = window.MAP_GEOJSON_DATA || null;
const DEFAULT_REGION_IMAGE = 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?w=1200';
const REGION_DATA = {
    ...(window.PROVINCE_DATA || {}),
    ...(window.PROVINCE_DOCX_DATA || {})
};
const REGION_KEY_ALIASES = {
    'da-nang-city': 'da-nang',
    'ha-noi-city': 'ha-noi',
    'hai-phong-city': 'hai-phong',
    'can-tho-city': 'can-tho',
    'ho-chi-minh-city': 'ho-chi-minh-city'
};

const REGION_NAME_OVERRIDES = {
    'da-nang-city': 'Đà Nẵng',
    'ha-noi-city': 'Hà Nội',
    'hai-phong-city': 'Hải Phòng',
    'can-tho-city': 'Cần Thơ',
    'ho-chi-minh-city': 'TP. Hồ Chí Minh'
};

const bgMusic = document.getElementById('bgMusic');
const audioPlayer = document.getElementById('audioPlayer');
const popupModal = document.getElementById('popupModal');
const popupCity = document.getElementById('popupCity');
const popupDescription = document.getElementById('popupDescription');
const popupImage = document.getElementById('popupImage');
const audioTitle = document.getElementById('audioTitle');
const audioPlaylist = document.getElementById('audioPlaylist');
const playBtn = document.getElementById('playBtn');
const progressBar = document.getElementById('progressBar');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const worldMap = document.getElementById('worldMap');
const mapLoading = document.getElementById('mapLoading');

let isBgMusicPlaying = false;
let isPlaying = false;
let currentAudioPath = '';
let currentAudioTracks = [];
let currentAudioTrackIndex = 0;
let currentRegionName = '';
let currentRegionProfile = null;
let currentRegionLayer = null;
let leafletMap = null;
let geoJsonLayer = null;
let mapBounds = null;
let regionLayers = [];
let visualizerInterval = null;
let backgroundFadeInterval = null;
let toastStyleInjected = false;
let isSwitchingAudioTrack = false;
let mapResizeRafId = 0;

function isLandscapeViewport() {
    return window.innerWidth >= window.innerHeight;
}

function getMapFocusSettings({ landscape = isLandscapeViewport(), isRegionFocus = false } = {}) {
    if (landscape) {
        return {
            pad: 0,
            padding: [0, 0],
            animate: isRegionFocus,
            duration: 0.75,
            extraZoom: 0,
            maxZoom: isRegionFocus ? 10.5 : 10.2
        };
    }

    return {
        pad: 0,
        padding: isRegionFocus ? [10, 10] : [4, 4],
        animate: isRegionFocus,
        duration: 0.75,
        extraZoom: isRegionFocus ? 0.7 : 1,
        maxZoom: isRegionFocus ? 11.2 : 11.5
    };
}

function focusMapToBounds(bounds, {
    pad = 0,
    padding = [0, 0],
    animate = false,
    duration = 0.75,
    extraZoom = 0.5,
    maxZoom = 11.5
} = {}) {
    if (!leafletMap || !bounds || !bounds.isValid()) {
        return;
    }

    leafletMap.fitBounds(bounds.pad(pad), {
        padding,
        animate,
        duration,
        maxZoom
    });

    if (!extraZoom) {
        return;
    }

    const applyZoomBoost = () => {
        const currentZoom = leafletMap.getZoom();

        if (!Number.isFinite(currentZoom)) {
            return;
        }

        leafletMap.setZoom(Math.min(currentZoom + extraZoom, maxZoom), {
            animate: false
        });
    };

    if (animate) {
        leafletMap.once('moveend', () => {
            requestAnimationFrame(applyZoomBoost);
        });
    } else {
        requestAnimationFrame(applyZoomBoost);
    }
}

function refitMapToViewport({ animate = false, isRegionFocus = false } = {}) {
    if (!mapBounds || !mapBounds.isValid()) {
        return;
    }

    focusMapToBounds(mapBounds, {
        ...getMapFocusSettings({ isRegionFocus }),
        animate
    });
}

async function getGeoJsonData() {
    if (MAP_GEOJSON_DATA) {
        return MAP_GEOJSON_DATA;
    }

    const response = await fetch(MAP_GEOJSON_URL, { cache: 'no-cache' });

    if (!response.ok) {
        throw new Error(`Unable to load ${MAP_GEOJSON_URL}`);
    }

    return response.json();
}

function normalizeRegionKey(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐÐ]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function resolveRegionKey(regionName) {
    const normalizedKey = normalizeRegionKey(regionName);
    return REGION_KEY_ALIASES[normalizedKey] || normalizedKey;
}

function resolveRegionDisplayName(regionName) {
    const normalizedKey = normalizeRegionKey(regionName);
    return REGION_NAME_OVERRIDES[normalizedKey] || regionName;
}

function buildFallbackRegionProfile(regionName) {
    return {
        title: regionName,
        intro: `Lời chúc từ ${regionName}.`,
        audioLabel: `Lời chúc từ ${regionName}`,
        image: DEFAULT_REGION_IMAGE,
        audio: '',
        audioTracks: []
    };
}

function formatAudioTrackLabel(trackPath) {
    const fileName = decodeURIComponent(String(trackPath || '').split('/').pop() || '');

    return fileName
        .replace(/\.[^.]+$/, '')
        .replace(/\s*-\s*volume\s*$/i, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAudioTracks(profile) {
    const sourceTracks = Array.isArray(profile?.audios) && profile.audios.length
        ? profile.audios
        : profile?.audio
            ? [profile.audio]
            : [];

    return sourceTracks
        .map((track, index) => {
            if (typeof track === 'string') {
                const src = track.trim();

                if (!src) {
                    return null;
                }

                return {
                    src,
                    label: formatAudioTrackLabel(src) || `Track ${index + 1}`,
                    index
                };
            }

            if (track && typeof track === 'object') {
                const src = String(track.src || track.audio || track.path || '').trim();

                if (!src) {
                    return null;
                }

                return {
                    src,
                    label: String(track.label || track.title || formatAudioTrackLabel(src) || `Track ${index + 1}`),
                    index
                };
            }

            return null;
        })
        .filter(Boolean);
}

function renderAudioPlaylist(audioTracks = [], activeTrackIndex = 0) {
    if (!audioPlaylist) {
        return;
    }

    audioPlaylist.innerHTML = '';

    if (!audioTracks.length) {
        audioPlaylist.hidden = true;
        return;
    }

    audioPlaylist.hidden = false;

    audioTracks.forEach((track, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'audio-track-btn';
        button.textContent = track.label || `Track ${index + 1}`;
        button.title = track.src;
        button.dataset.index = String(index);
        button.setAttribute('aria-pressed', index === activeTrackIndex ? 'true' : 'false');

        if (index === activeTrackIndex) {
            button.classList.add('is-active');
        }

        button.addEventListener('click', () => {
            loadAudioTrack(index, { autoplay: true });
        });

        audioPlaylist.appendChild(button);
    });
}

function updateAudioTitle(regionProfile = null) {
    if (!audioTitle) {
        return;
    }

    const title = regionProfile?.title || currentRegionName || 'Khu vực này';
    const baseLabel = regionProfile?.audioLabel || `Lời chúc từ ${title}`;

    if (!currentAudioTracks.length) {
        audioTitle.textContent = `Chưa có audio cho ${title}`;
        return;
    }

    audioTitle.textContent = currentAudioTracks.length > 1
        ? `${baseLabel} (${currentAudioTracks.length} file)`
        : baseLabel;
}

function loadAudioTrack(trackIndex = 0, { autoplay = false } = {}) {
    if (!audioPlayer || !currentAudioTracks.length) {
        return false;
    }

    const nextIndex = Math.min(Math.max(trackIndex, 0), currentAudioTracks.length - 1);
    const track = currentAudioTracks[nextIndex];

    if (!track?.src) {
        return false;
    }

    isSwitchingAudioTrack = true;
    currentAudioTrackIndex = nextIndex;
    currentAudioPath = encodeURI(track.src);
    audioPlayer.src = currentAudioPath;
    audioPlayer.load();

    updateAudioTitle(currentRegionProfile);
    renderAudioPlaylist(currentAudioTracks, currentAudioTrackIndex);
    setAudioControlsEnabled(true);
    resetProgressUI();

    if (!autoplay) {
        syncPlayButtonState(false);
        stopVisualizer();
        isSwitchingAudioTrack = false;
        return true;
    }

    audioPlayer.play().then(() => {
        isSwitchingAudioTrack = false;
        syncPlayButtonState(true);
        startVisualizer();
    }).catch((error) => {
        isSwitchingAudioTrack = false;
        console.log('Playback error:', error);
        showToast('Không phát được file âm thanh này.');
        syncPlayButtonState(false);
        stopVisualizer();
    });

    return true;
}

function getRegionProfile(regionName, regionKey = resolveRegionKey(regionName)) {
    const profile = REGION_DATA[regionKey] || REGION_DATA[normalizeRegionKey(regionName)];

    if (!profile) {
        return buildFallbackRegionProfile(resolveRegionDisplayName(regionName));
    }

    const title = profile.title || resolveRegionDisplayName(regionName);
    const audioTracks = normalizeAudioTracks(profile);

    return {
        title,
        intro: profile.intro || `Lời chúc từ ${title}.`,
        audioLabel: profile.audioLabel || `Lời chúc từ ${title}`,
        image: profile.image || DEFAULT_REGION_IMAGE,
        audio: audioTracks[0]?.src || profile.audio || '',
        audioTracks
    };
}

function syncPlayButtonState(playing) {
    isPlaying = playing;

    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');

    if (playIcon) {
        playIcon.style.display = playing ? 'none' : 'block';
    }

    if (pauseIcon) {
        pauseIcon.style.display = playing ? 'block' : 'none';
    }
}

function setAudioControlsEnabled(isEnabled) {
    if (playBtn) {
        playBtn.disabled = !isEnabled;
        playBtn.title = isEnabled ? 'Phát âm thanh' : 'Khu vực này chưa có file âm thanh';
    }

    const audioPlayerContainer = document.querySelector('.audio-player');
    if (audioPlayerContainer) {
        audioPlayerContainer.classList.toggle('audio-player--no-audio', !isEnabled);
    }
}

function ensureToastStyles() {
    if (toastStyleInjected) {
        return;
    }

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInUp {
            from {
                transform: translateY(100px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }

        @keyframes slideOutDown {
            from {
                transform: translateY(0);
                opacity: 1;
            }
            to {
                transform: translateY(100px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
    toastStyleInjected = true;
}

function showToast(message) {
    ensureToastStyles();

    const toast = document.createElement('div');
    toast.className = 'copy-notification';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 10px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        animation: slideInUp 0.3s ease-out;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOutDown 0.3s ease-out';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 2500);
}

function showCopyNotification(message) {
    showToast(message);
}

function scrollToMap() {
    const mapSection = document.getElementById('soundMap');
    mapSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!bgMusic || isBgMusicPlaying) {
        return;
    }

    bgMusic.volume = 0.3;
    bgMusic.play().catch(() => {
        console.log('Audio autoplay prevented');
    });
    isBgMusicPlaying = true;
}

async function loadProvinceMap() {
    if (!worldMap) {
        return;
    }

    if (typeof L === 'undefined') {
        console.error('Leaflet is not available.');
        if (mapLoading) {
            mapLoading.textContent = 'Thư viện bản đồ chưa tải được.';
            mapLoading.classList.add('map-loading--error');
        }
        return;
    }

    if (mapLoading) {
        mapLoading.style.display = 'flex';
        mapLoading.textContent = 'Đang tải bản đồ Việt Nam...';
    }

    try {
        if (!leafletMap) {
            leafletMap = L.map(worldMap, {
                zoomControl: false,
                attributionControl: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                dragging: true,
                tap: true,
                worldCopyJump: true,
                preferCanvas: false,
                minZoom: 4,
                maxZoom: 12,
                zoomSnap: 0.25,
                zoomDelta: 0.25
            });

            leafletMap.setView([16.2, 106.2], 5.9);
            leafletMap.on('click', () => {
                if (popupModal?.classList.contains('active')) {
                    return;
                }

                resetZoom();
            });
        }

        const geojson = await getGeoJsonData();

        regionLayers = [];

        if (geoJsonLayer) {
            geoJsonLayer.remove();
            geoJsonLayer = null;
        }

        geoJsonLayer = L.geoJSON(geojson, {
            style: styleProvinceFeature,
            onEachFeature: bindProvinceFeature
        }).addTo(leafletMap);

        mapBounds = geoJsonLayer.getBounds();

        refitMapToViewport({ animate: false, isRegionFocus: false });

        requestAnimationFrame(() => {
            leafletMap?.invalidateSize();
        });

        if (mapLoading) {
            mapLoading.style.display = 'none';
        }
    } catch (error) {
        console.error('Failed to load province map:', error);
        if (mapLoading) {
            mapLoading.textContent = 'Không tải được bản đồ tỉnh thành.';
            mapLoading.classList.add('map-loading--error');
            mapLoading.style.display = 'flex';
        }
    }
}

function getFeatureIdentity(feature) {
    const rawName = feature?.properties?.Name || feature?.properties?.name || 'Khu vực';
    const note = feature?.properties?.Note || '';
    const noteKey = normalizeRegionKey(note);

    if (noteKey.includes('hoang-sa') || noteKey.includes('paracel')) {
        return {
            displayName: 'Hoàng Sa',
            regionKey: 'hoang-sa',
            isSpecial: true,
            sourceName: rawName,
            note
        };
    }

    if (noteKey.includes('truong-sa') || noteKey.includes('spratly')) {
        return {
            displayName: 'Trường Sa',
            regionKey: 'truong-sa',
            isSpecial: true,
            sourceName: rawName,
            note
        };
    }

    const normalizedName = normalizeRegionKey(rawName);
    const regionKey = resolveRegionKey(rawName);
    const displayName = REGION_NAME_OVERRIDES[normalizedName] || REGION_NAME_OVERRIDES[regionKey] || rawName;

    return {
        displayName,
        regionKey,
        isSpecial: false,
        sourceName: rawName,
        note
    };
}

function styleProvinceFeature(feature) {
    const identity = getFeatureIdentity(feature);

    return {
        className: `province-region${identity.isSpecial ? ' province-region--island' : ''}`,
        color: identity.isSpecial ? '#feca57' : '#ffffff',
        weight: identity.isSpecial ? 1.5 : 1.1,
        opacity: 0.88,
        fillColor: identity.isSpecial ? '#feca57' : '#ff6b9d',
        fillOpacity: identity.isSpecial ? 0.25 : 0.18,
        lineJoin: 'round',
        lineCap: 'round',
        dashArray: identity.isSpecial ? '4 4' : '',
        interactive: true
    };
}

function bindProvinceFeature(feature, layer) {
    const identity = getFeatureIdentity(feature);
    layer._regionIdentity = identity;
    regionLayers.push(layer);

    layer.bindTooltip(identity.displayName, {
        direction: 'center',
        sticky: true,
        opacity: 0.95,
        className: 'province-tooltip'
    });

    layer.on('mouseover', () => {
        if (currentRegionLayer !== layer) {
            layer.setStyle({
                color: '#feca57',
                weight: identity.isSpecial ? 2.4 : 2.2,
                fillOpacity: identity.isSpecial ? 0.38 : 0.32
            });
        }

        layer.bringToFront();
    });

    layer.on('mouseout', () => {
        if (currentRegionLayer !== layer && geoJsonLayer) {
            geoJsonLayer.resetStyle(layer);
        }
    });

    layer.on('click', (event) => {
        event.originalEvent?.stopPropagation();
        handleRegionSelection(identity.displayName, layer, identity);
    });

    layer.once('add', () => {
        const element = layer.getElement?.();

        if (!element || element.dataset.regionA11yBound === 'true') {
            return;
        }

        element.dataset.regionA11yBound = 'true';
        element.setAttribute('tabindex', '0');
        element.setAttribute('role', 'button');
        element.setAttribute('focusable', 'true');
        element.setAttribute('aria-label', identity.displayName);

        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleRegionSelection(identity.displayName, layer, identity);
            }
        });
    });
}

function setActiveRegion(regionLayer) {
    if (currentRegionLayer && currentRegionLayer !== regionLayer && geoJsonLayer) {
        geoJsonLayer.resetStyle(currentRegionLayer);
    }

    currentRegionLayer = regionLayer || null;

    if (currentRegionLayer) {
        currentRegionLayer.setStyle({
            color: '#feca57',
            weight: currentRegionLayer._regionIdentity?.isSpecial ? 2.8 : 2.4,
            fillOpacity: 0.42
        });
        currentRegionLayer.bringToFront();
    }
}

function zoomToRegion(regionLayer) {
    if (!leafletMap || !regionLayer) {
        return;
    }

    const bounds = regionLayer.getBounds?.();

    if (!bounds || !bounds.isValid()) {
        return;
    }

    const padding = regionLayer._regionIdentity?.isSpecial ? 0.25 : 0.12;

    focusMapToBounds(bounds, {
        ...getMapFocusSettings({ landscape: isLandscapeViewport(), isRegionFocus: true }),
        pad: padding
    });
}

function handleRegionSelection(regionName, regionLayer, regionIdentity = null) {
    const identity = regionIdentity || {
        displayName: regionName,
        regionKey: resolveRegionKey(regionName),
        isSpecial: false
    };

    const regionProfile = getRegionProfile(identity.displayName, identity.regionKey);

    currentRegionName = identity.displayName;
    setActiveRegion(regionLayer);
    zoomToRegion(regionLayer);
    openPopup(identity.displayName, regionProfile);
}

function resetZoom() {
    if (currentRegionLayer && geoJsonLayer) {
        geoJsonLayer.resetStyle(currentRegionLayer);
    }

    currentRegionLayer = null;
    currentRegionName = '';

    if (leafletMap && mapBounds && mapBounds.isValid()) {
        refitMapToViewport({ animate: true, isRegionFocus: false });
    }
}

function openPopup(regionName, regionProfile = getRegionProfile(regionName)) {
    if (!popupModal) {
        return;
    }

    currentRegionName = regionName;
    currentRegionProfile = regionProfile;
    currentAudioTracks = Array.isArray(regionProfile.audioTracks) ? regionProfile.audioTracks : [];
    currentAudioTrackIndex = 0;
    currentAudioPath = '';

    if (popupCity) {
        popupCity.textContent = regionProfile.title || regionName;
    }

    if (popupDescription) {
        popupDescription.textContent = regionProfile.intro || `Lời chúc từ ${regionProfile.title || regionName}.`;
    }

    if (popupImage) {
        popupImage.src = regionProfile.image || DEFAULT_REGION_IMAGE;
        popupImage.alt = `Ảnh giới thiệu ${regionProfile.title || regionName}`;
    }

    if (currentAudioTracks.length) {
        setAudioControlsEnabled(true);
        loadAudioTrack(0, { autoplay: false });
    } else {
        if (audioPlaylist) {
            audioPlaylist.innerHTML = '';
            audioPlaylist.hidden = true;
        }

        currentAudioTrackIndex = 0;
        currentAudioPath = '';
        audioPlayer.removeAttribute('src');
        audioPlayer.load();
        updateAudioTitle(regionProfile);
        setAudioControlsEnabled(false);
        resetProgressUI();
    }

    popupModal.classList.add('active');
    fadeOutBgMusic();
}

function closePopup() {
    if (!popupModal) {
        return;
    }

    popupModal.classList.remove('active');

    if (audioPlayer) {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
    }

    currentAudioTracks = [];
    currentAudioTrackIndex = 0;
    currentAudioPath = '';
    currentRegionProfile = null;

    if (audioPlaylist) {
        audioPlaylist.innerHTML = '';
        audioPlaylist.hidden = true;
    }

    syncPlayButtonState(false);
    stopVisualizer();
    resetProgressUI();
    fadeInBgMusic();
    resetZoom();
}

function togglePlay() {
    if (!currentAudioPath) {
        showToast('Khu vực này chưa có file âm thanh.');
        return;
    }

    if (!audioPlayer) {
        return;
    }

    if (isPlaying) {
        audioPlayer.pause();
        syncPlayButtonState(false);
        stopVisualizer();
        return;
    }

    audioPlayer.play().then(() => {
        syncPlayButtonState(true);
        startVisualizer();
    }).catch((error) => {
        console.log('Playback error:', error);
        showToast('Không phát được file âm thanh này.');
        syncPlayButtonState(false);
        stopVisualizer();
    });
}

function resetProgressUI() {
    if (progressBar) {
        progressBar.style.width = '0%';
    }

    if (currentTimeEl) {
        currentTimeEl.textContent = '0:00';
    }

    if (durationEl) {
        durationEl.textContent = '0:00';
    }
}

function resetPlayer() {
    syncPlayButtonState(false);
    resetProgressUI();
    stopVisualizer();
}

function updateProgress() {
    if (!audioPlayer || !audioPlayer.duration || !progressBar || !currentTimeEl) {
        return;
    }

    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressBar.style.width = `${progress}%`;
    currentTimeEl.textContent = formatTime(audioPlayer.currentTime);
}

function updateDuration() {
    if (!audioPlayer || !durationEl) {
        return;
    }

    if (audioPlayer.duration) {
        durationEl.textContent = formatTime(audioPlayer.duration);
    } else {
        durationEl.textContent = '0:00';
    }
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return '0:00';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function startVisualizer() {
    const bars = document.querySelectorAll('.visualizer .bar');
    clearInterval(visualizerInterval);

    visualizerInterval = setInterval(() => {
        bars.forEach((bar) => {
            const height = Math.random() * 80 + 20;
            bar.style.height = `${height}%`;
        });
    }, 150);
}

function stopVisualizer() {
    clearInterval(visualizerInterval);
    const bars = document.querySelectorAll('.visualizer .bar');
    bars.forEach((bar, index) => {
        bar.style.height = `${20 + index * 10}%`;
    });
}

function fadeOutBgMusic() {
    if (!bgMusic || !isBgMusicPlaying) {
        return;
    }

    clearInterval(backgroundFadeInterval);
    let volume = bgMusic.volume;

    backgroundFadeInterval = setInterval(() => {
        if (volume > 0.05) {
            volume -= 0.05;
            bgMusic.volume = Math.max(0, volume);
        } else {
            bgMusic.volume = 0;
            bgMusic.pause();
            clearInterval(backgroundFadeInterval);
        }
    }, 100);
}

function fadeInBgMusic() {
    if (!bgMusic || !isBgMusicPlaying) {
        return;
    }

    clearInterval(backgroundFadeInterval);
    bgMusic.play().catch((error) => {
        console.log('Audio play error:', error);
    });

    let volume = 0;
    bgMusic.volume = 0;

    backgroundFadeInterval = setInterval(() => {
        if (volume < 0.3) {
            volume += 0.05;
            bgMusic.volume = Math.min(0.3, volume);
        } else {
            clearInterval(backgroundFadeInterval);
        }
    }, 100);
}

function startCountdown() {
    const birthdayEnd = new Date('2026-04-29T23:59:59').getTime();

    function setCountdownValue(prefix, unit, value) {
        const elementId = prefix ? `${prefix}${unit.charAt(0).toUpperCase()}${unit.slice(1)}` : unit;
        const element = document.getElementById(elementId);

        if (element) {
            element.textContent = value;
        }
    }

    function updateCountdown() {
        const now = Date.now();
        const distance = birthdayEnd - now;
        const countdownPrefixes = ['', 'hero'];

        const values = distance < 0 ? {
            days: '00',
            hours: '00',
            minutes: '00',
            seconds: '00'
        } : {
            days: String(Math.floor(distance / (1000 * 60 * 60 * 24))).padStart(2, '0'),
            hours: String(Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0'),
            minutes: String(Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0'),
            seconds: String(Math.floor((distance % (1000 * 60)) / 1000)).padStart(2, '0')
        };

        countdownPrefixes.forEach((prefix) => {
            setCountdownValue(prefix, 'days', values.days);
            setCountdownValue(prefix, 'hours', values.hours);
            setCountdownValue(prefix, 'minutes', values.minutes);
            setCountdownValue(prefix, 'seconds', values.seconds);
        });
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
}

function shareTwitter() {
    const text = '2026 Birthday Project: The Sound of Love for Dạ Kao Supassara 💜 #BirthdayProject2026 #SoundOfLove';
    const url = window.location.href;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
}

function shareFacebook() {
    const url = window.location.href;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
}

function copyLink() {
    const url = window.location.href;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showCopyNotification('Link đã được copy! 📋');
        }).catch(() => {
            fallbackCopyToClipboard(url);
        });
    } else {
        fallbackCopyToClipboard(url);
    }
}

function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();

    try {
        document.execCommand('copy');
        showCopyNotification('Link đã được copy! 📋');
    } catch (error) {
        showCopyNotification('Không thể copy link ❌');
    }

    document.body.removeChild(textArea);
}

function wireAudioEvents() {
    if (!audioPlayer) {
        return;
    }

    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('ended', () => {
        const hasNextTrack = currentAudioTracks[currentAudioTrackIndex + 1];

        if (hasNextTrack) {
            loadAudioTrack(currentAudioTrackIndex + 1, { autoplay: true });
            return;
        }

        syncPlayButtonState(false);
        stopVisualizer();
        fadeInBgMusic();
    });
    audioPlayer.addEventListener('pause', () => {
        if (!audioPlayer.ended && !isSwitchingAudioTrack) {
            syncPlayButtonState(false);
            stopVisualizer();
        }
    });
    audioPlayer.addEventListener('error', () => {
        syncPlayButtonState(false);
        stopVisualizer();
        showToast('Không tải được file âm thanh của khu vực này.');
    });
}

function wireProgressSeek() {
    const audioProgress = document.querySelector('.audio-progress');
    if (!audioProgress) {
        return;
    }

    audioProgress.addEventListener('click', (event) => {
        if (!audioPlayer || !audioPlayer.duration || !currentAudioPath) {
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        const clampedPercent = Math.min(Math.max(percent, 0), 1);
        audioPlayer.currentTime = clampedPercent * audioPlayer.duration;
    });
}

function wireKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (!popupModal || !popupModal.classList.contains('active')) {
            return;
        }

        if (event.key === 'Escape') {
            closePopup();
            return;
        }

        if (event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            togglePlay();
        }
    });
}

function wireModalBackdrop() {
    document.addEventListener('click', (event) => {
        if (event.target === popupModal) {
            closePopup();
        }
    });
}

function wireHeroParallax() {
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero-section');

        if (hero && scrolled < window.innerHeight) {
            hero.style.transform = `translateY(${scrolled * 0.5}px)`;
            hero.style.opacity = 1 - (scrolled / window.innerHeight);
        }
    });
}

function wireMapResizeHandling() {
    window.addEventListener('resize', () => {
        if (!leafletMap || !mapBounds || !mapBounds.isValid()) {
            return;
        }

        cancelAnimationFrame(mapResizeRafId);
        mapResizeRafId = requestAnimationFrame(() => {
            leafletMap.invalidateSize();
            refitMapToViewport({ animate: false, isRegionFocus: Boolean(currentRegionLayer) });
        });
    });
}

function startRegionPulse() {
    setInterval(() => {
        if (!regionLayers.length) {
            return;
        }

        const candidates = regionLayers.filter((layer) => layer?.getElement?.());
        if (!candidates.length) {
            return;
        }

        const randomRegion = candidates[Math.floor(Math.random() * candidates.length)];
        const regionElement = randomRegion?.getElement?.();

        if (!regionElement) {
            return;
        }

        regionElement.classList.add('pulse-spark');
        setTimeout(() => {
            regionElement.classList.remove('pulse-spark');
        }, 650);
    }, 2400);
}

function initializeApp() {
    loadProvinceMap();
    startCountdown();
    wireAudioEvents();
    wireProgressSeek();
    wireKeyboardShortcuts();
    wireModalBackdrop();
    wireHeroParallax();
    wireMapResizeHandling();
    startRegionPulse();
}

document.addEventListener('DOMContentLoaded', initializeApp);

console.log('🎉 Birthday Project loaded successfully!');
console.log('💝 Made with love for Dạ Kao Supassara');
