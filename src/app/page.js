"use client";

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, ChevronsLeft, ChevronsRight, Search, X, ArrowDown, Minus, Plus, Settings, Loader } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

// --- Constants ---
const ALQURAN_API_BASE_URL = 'https://api.alquran.cloud/v1';
const TOTAL_SURAHS = 114;

// --- API Service (for better separation of concerns) ---
const quranApiService = {
    /**
     * Fetches the list of all surahs.
     */
    async getSurahs() {
        const res = await fetch(`${ALQURAN_API_BASE_URL}/surah`);
        if (!res.ok) throw new Error(`Failed to fetch surahs: ${res.statusText}`);
        const json = await res.json();
        // Add robust check for data structure
        if (json.code !== 200 || !Array.isArray(json.data)) {
            throw new Error('Invalid data structure received for surahs.');
        }
        return json.data;
    },

    /**
     * Fetches available Arabic audio editions.
     */
    async getAudioEditions() {
        const res = await fetch(`${ALQURAN_API_BASE_URL}/edition?format=audio&language=ar`);
        if (!res.ok) throw new Error(`Failed to fetch audio editions: ${res.statusText}`);
        const json = await res.json();
        // Add robust check for data structure
        if (json.code !== 200 || !Array.isArray(json.data)) {
            throw new Error('Invalid data structure received for editions.');
        }
        // Filter for reliable editions
        return (json.data).filter(e => e.identifier.startsWith('ar.') && e.format === 'audio');
    },

    /**
     * Fetches all data for a specific surah (audio, text, translation) in a single call.
     * @param {number} surahNumber - The number of the surah to fetch.
     * @param {string} editionId - The identifier for the audio edition.
     */
    async getSurahData(surahNumber, editionId) {
        const editions = `${editionId},quran-uthmani,en.sahih`;
        const res = await fetch(`${ALQURAN_API_BASE_URL}/surah/${surahNumber}/editions/${editions}`);
        if (!res.ok) {
             const errorBody = await res.json().catch(() => ({ data: res.statusText }));
             throw new Error(`Failed to fetch surah data: ${errorBody.data || res.statusText}`);
        }
        const json = await res.json();
        
        // Add robust check for data structure
        if (json.code !== 200 || !Array.isArray(json.data)) {
            throw new Error(json.data || 'Invalid data structure received for surah.');
        }

        // *** FIX: Access the identifier from the nested 'edition' object ***
        const audioData = json.data.find(d => d.edition.identifier === editionId);
        const textData = json.data.find(d => d.edition.identifier === 'quran-uthmani');
        const translationData = json.data.find(d => d.edition.identifier === 'en.sahih');

        if (!audioData || !textData || !translationData) {
            throw new Error('One or more required editions could not be found for this surah.');
        }

        // Combine the data into a single, structured object
        const combinedAyahs = audioData.ayahs.map((ayah, i) => ({
            ...ayah,
            textArabic: textData.ayahs[i]?.text || 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', // Fallback for Basmalah
            textEnglish: translationData.ayahs[i]?.text || 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
        }));

        return { ...audioData, ayahs: combinedAyahs };
    }
};


// --- Custom Hook (to encapsulate logic and state) ---

/**
 * Custom hook to manage the state and logic of the Quran Player.
 */
const useQuranPlayer = () => {
    // State declarations
    const [surahs, setSurahs] = useState([]);
    const [audioEditions, setAudioEditions] = useState([]);
    const [selectedSurahNum, setSelectedSurahNum] = useState(1);
    const [selectedEditionId, setSelectedEditionId] = useState('ar.alafasy');
    const [surahData, setSurahData] = useState(null);
    const [currentAyahIndex, setCurrentAyahIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [continuousPlay, setContinuousPlay] = useState(true);
    const [arabicFontSize, setArabicFontSize] = useState(2.25);
    const [englishFontSize, setEnglishFontSize] = useState(1.125);
    const [audioProgress, setAudioProgress] = useState({ currentTime: 0, duration: 0 });

    // Refs
    const audioRef = useRef(null);
    const autoPlayOnLoadRef = useRef(false);

    // Fetch initial data (list of surahs and editions)
    useEffect(() => {
        const fetchInitialData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [surahsRes, editionsRes] = await Promise.all([
                    quranApiService.getSurahs(),
                    quranApiService.getAudioEditions()
                ]);
                setSurahs(surahsRes);
                setAudioEditions(editionsRes);
            } catch (err) {
                console.error("Error fetching initial data:", err);
                setError(err.message);
            }
            // We keep isLoading true until the first surah data is also fetched.
        };
        fetchInitialData();
    }, []);

    // Fetch data for the selected surah whenever selection changes
    useEffect(() => {
        if (!selectedSurahNum || !selectedEditionId) return;

        const fetchSurahData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const data = await quranApiService.getSurahData(selectedSurahNum, selectedEditionId);
                setSurahData(data);
                setCurrentAyahIndex(0); // Reset to first ayah
                if (isPlaying) { // If it was playing, flag to autoplay the new surah
                    autoPlayOnLoadRef.current = true;
                }
            } catch (err) {
                console.error("Error fetching surah data:", err);
                setError(err.message);
                setSurahData(null); // Clear potentially stale data
                setIsPlaying(false); // Stop playback on error
            } finally {
                setIsLoading(false);
            }
        };
        fetchSurahData();
    }, [selectedSurahNum, selectedEditionId]);

    // --- Playback Controls ---

    const handleNextAyah = useCallback(() => {
        if (!surahData) return;
        const isLastAyah = currentAyahIndex >= surahData.ayahs.length - 1;

        if (isLastAyah) {
            if (continuousPlay && selectedSurahNum < TOTAL_SURAHS) {
                setSelectedSurahNum(s => s + 1);
            } else {
                setIsPlaying(false);
            }
        } else {
            setCurrentAyahIndex(prev => prev + 1);
            autoPlayOnLoadRef.current = true;
        }
    }, [currentAyahIndex, surahData, continuousPlay, selectedSurahNum]);

    const handlePrevAyah = useCallback(() => {
        if (currentAyahIndex > 0) {
            setCurrentAyahIndex(prev => prev - 1);
            autoPlayOnLoadRef.current = true;
        } else if (selectedSurahNum > 1) {
            setSelectedSurahNum(s => s - 1);
            // The useEffect for surah change will handle fetching and resetting the ayah index.
        }
    }, [currentAyahIndex, selectedSurahNum]);
    
    const handleNextSurah = useCallback(() => {
        if (selectedSurahNum < TOTAL_SURAHS) {
            setSelectedSurahNum(s => s + 1);
        }
    }, [selectedSurahNum]);

    const handlePrevSurah = useCallback(() => {
        if (selectedSurahNum > 1) {
            setSelectedSurahNum(s => s - 1);
        }
    }, [selectedSurahNum]);

    // Effect to control the audio element
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !surahData?.ayahs[currentAyahIndex]) return;

        const currentAyah = surahData.ayahs[currentAyahIndex];
        const isNewSrc = audio.src !== currentAyah.audio;

        if (isNewSrc) {
            audio.src = currentAyah.audio;
            audio.load();
        }

        const playAudio = () => {
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    console.warn("Audio play prevented:", e);
                    setIsPlaying(false); // Update UI to reflect non-playing state
                });
            }
        };

        if (isPlaying) {
            if (isNewSrc) {
                // If src changed, wait for 'canplay' to start playing
                autoPlayOnLoadRef.current = true;
            } else {
                // If just resuming, play immediately
                playAudio();
            }
        } else {
            audio.pause();
        }

        const handleCanPlay = () => {
            if (autoPlayOnLoadRef.current) {
                playAudio();
                autoPlayOnLoadRef.current = false;
            }
        };
        const updateProgress = () => setAudioProgress({ currentTime: audio.currentTime, duration: audio.duration });

        audio.addEventListener('ended', handleNextAyah);
        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', updateProgress);
        audio.addEventListener('canplay', handleCanPlay);

        return () => {
            audio.removeEventListener('ended', handleNextAyah);
            audio.removeEventListener('timeupdate', updateProgress);
            audio.removeEventListener('loadedmetadata', updateProgress);
            audio.removeEventListener('canplay', handleCanPlay);
        };
    }, [surahData, currentAyahIndex, isPlaying, handleNextAyah]);

    // Effect to control volume and mute
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = volume;
        audio.muted = isMuted;
    }, [volume, isMuted]);
    
    // --- UI Callbacks ---
    
    const togglePlayPause = useCallback(() => setIsPlaying(p => !p), []);
    const handleSeek = useCallback((e) => {
        const audio = audioRef.current;
        if (audio) {
            audio.currentTime = parseFloat(e.target.value);
            setAudioProgress(prev => ({ ...prev, currentTime: audio.currentTime }));
        }
    }, []);
    const handleVolumeChange = useCallback((e) => setVolume(parseFloat(e.target.value)), []);
    const toggleMute = useCallback(() => setIsMuted(p => !p), []);
    const handleFontSizeChange = useCallback((type, change) => {
        const setter = type === 'arabic' ? setArabicFontSize : setEnglishFontSize;
        const min = type === 'arabic' ? 1.5 : 0.875;
        const max = type === 'arabic' ? 4.0 : 2.0;
        setter(prev => Math.max(min, Math.min(max, prev + change)));
    }, []);

    return {
        // State
        surahs, audioEditions, selectedSurahNum, selectedEditionId, surahData,
        currentAyahIndex, isPlaying, isLoading, error, isMuted, volume,
        continuousPlay, arabicFontSize, englishFontSize, audioProgress, audioRef,
        // Callbacks
        setSelectedSurahNum, setSelectedEditionId, togglePlayPause, handleNextAyah,
        handlePrevAyah, handleNextSurah, handlePrevSurah, handleSeek, handleVolumeChange,
        toggleMute, setContinuousPlay, handleFontSizeChange,
    };
};


// --- UI Components (Memoized for Performance) ---

const SkeletonLoader = memo(() => (
    <div className="space-y-6 animate-pulse p-4 sm:p-6">
        <div className="h-16 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
        <div className="space-y-4">
            <div className="h-8 w-3/4 mx-auto bg-slate-200 dark:bg-slate-700 rounded"></div>
            <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded"></div>
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded"></div>
        </div>
        <div className="flex justify-center items-center space-x-4 pt-4">
            <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full"></div>
            <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full"></div>
            <div className="w-20 h-20 bg-cyan-200 dark:bg-cyan-700 rounded-full"></div>
            <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full"></div>
            <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full"></div>
        </div>
    </div>
));
SkeletonLoader.displayName = 'SkeletonLoader';

const ErrorDisplay = memo(({ message }) => (
    <div className="text-center p-6 sm:p-10 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg mx-4" role="alert">
        <p className="font-semibold text-lg">An Error Occurred</p>
        <p className="text-sm sm:text-base mt-2">{message || 'Please try refreshing the page or selecting a different surah/reciter.'}</p>
    </div>
));
ErrorDisplay.displayName = 'ErrorDisplay';

const CustomSelect = memo(({ options, value, onChange, placeholder, searchEnabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const selectRef = useRef(null);

    const filteredOptions = searchEnabled
        ? options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()))
        : options;

    const handleSelect = useCallback((optionValue) => {
        onChange(optionValue);
        setIsOpen(false);
        setSearchTerm('');
    }, [onChange]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (selectRef.current && !selectRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const selectedLabel = options.find(opt => opt.value === value)?.label || placeholder;

    return (
        <div className="relative w-full" ref={selectRef}>
            <button
                onClick={() => setIsOpen(o => !o)}
                className="w-full flex justify-between items-center p-3 sm:p-4 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-700/50 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition-all duration-200 shadow-sm"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className="truncate text-base sm:text-lg font-medium text-left">{selectedLabel}</span>
                <ArrowDown size={20} aria-hidden="true" className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-20 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl shadow-xl max-h-72 overflow-y-auto"
                        role="listbox"
                    >
                        {searchEnabled && (
                            <div className="p-3 border-b dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
                                <div className="relative">
                                    <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full p-2 pl-10 pr-8 border-0 rounded-lg bg-slate-100 dark:bg-slate-700 focus:ring-2 focus:ring-cyan-500 text-slate-800 dark:text-slate-200 text-base"
                                        aria-label="Search options"
                                    />
                                    {searchTerm && (
                                        <button onClick={(e) => { e.stopPropagation(); setSearchTerm(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1" aria-label="Clear search">
                                            <X size={16} aria-hidden="true" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                        <ul>
                            {filteredOptions.length > 0 ? filteredOptions.map(option => (
                                <li
                                    key={option.value}
                                    onClick={() => handleSelect(option.value)}
                                    className="p-3 sm:p-4 hover:bg-cyan-50 dark:hover:bg-cyan-900/50 cursor-pointer text-left text-base sm:text-lg transition-colors duration-150"
                                    role="option"
                                    aria-selected={value === option.value}
                                >
                                    {option.label}
                                </li>
                            )) : <li className="p-3 text-center text-slate-500 text-base">No results found</li>}
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});
CustomSelect.displayName = 'CustomSelect';

const AyahDisplay = memo(({ surah, ayah, arabicFontSize, englishFontSize }) => {
    if (!surah || !ayah) return null;

    return (
        <div className="text-center space-y-4 sm:space-y-6 px-2">
            <div className="border-b-2 border-cyan-500/20 pb-4">
                <h2 className="text-3xl sm:text-4xl font-bold text-cyan-600 dark:text-cyan-400">{surah.englishName}</h2>
                <p className="text-xl sm:text-2xl text-slate-600 dark:text-slate-300 font-mono">{surah.name}</p>
                <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">
                    {surah.revelationType} - {surah.numberOfAyahs} Ayahs
                </p>
            </div>
            <div className="space-y-4 min-h-[200px] sm:min-h-[220px] flex flex-col justify-center">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={ayah.number} // Animate when ayah changes
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.4 }}
                        className="space-y-4"
                    >
                        <p className="text-base sm:text-lg font-medium text-slate-500 dark:text-slate-400">Ayah {ayah.numberInSurah}</p>
                        <p className="font-['Amiri',_serif] leading-loose px-2 sm:px-4" dir="rtl" style={{ fontSize: `${arabicFontSize}rem` }}>
                            {ayah.textArabic}
                        </p>
                        <p className="text-slate-600 dark:text-slate-300 px-2 sm:px-4 italic" style={{ fontSize: `${englishFontSize}rem` }}>
                            &quot;{ayah.textEnglish}&quot;
                        </p>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
});
AyahDisplay.displayName = 'AyahDisplay';

const PlayerControls = memo(({
    isPlaying, onPlayPause, onNextAyah, onPrevAyah, onNextSurah, onPrevSurah,
    isFirstAyah, isLastAyah, isFirstSurah, isLastSurah,
    volume, onVolumeChange, isMuted, onMuteToggle, audioProgress, onSeek
}) => {
    const formatTime = (seconds) => {
        if (!isFinite(seconds) || seconds < 0) return '00:00';
        return new Date(seconds * 1000).toISOString().slice(14, 19);
    };

    return (
        <div className="flex flex-col items-center space-y-4 pt-4 px-2">
            {/* Audio Progress Bar */}
            <div className="w-full max-w-md flex items-center space-x-3">
                <time className="text-xs font-mono text-slate-500 dark:text-slate-400 w-10 text-center" dateTime={`PT${Math.round(audioProgress.currentTime)}S`}>{formatTime(audioProgress.currentTime)}</time>
                <input
                    type="range"
                    min="0"
                    max={audioProgress.duration || 0}
                    value={audioProgress.currentTime}
                    onChange={onSeek}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-slate-700 accent-cyan-600 outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-100 dark:focus:ring-offset-slate-800 focus:ring-cyan-500"
                    aria-label="Audio progress"
                />
                <time className="text-xs font-mono text-slate-500 dark:text-slate-400 w-10 text-center" dateTime={`PT${Math.round(audioProgress.duration)}S`}>{formatTime(audioProgress.duration)}</time>
            </div>

            {/* Main Playback Controls */}
            <div className="flex items-center space-x-2 sm:space-x-4">
                <button onClick={onPrevSurah} disabled={isFirstSurah} title="Previous Surah" aria-label="Previous Surah" className="p-3 sm:p-4 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200">
                    <ChevronsLeft size={24} aria-hidden="true" />
                </button>
                <button onClick={onPrevAyah} disabled={isFirstAyah} title="Previous Ayah" aria-label="Previous Ayah" className="p-3 sm:p-4 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200">
                    <SkipBack size={24} aria-hidden="true" />
                </button>
                <button onClick={onPlayPause} title={isPlaying ? "Pause" : "Play"} aria-label={isPlaying ? "Pause" : "Play"} className="p-5 sm:p-6 bg-gradient-to-br from-cyan-500 to-teal-600 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-cyan-300 dark:focus:ring-cyan-800">
                    {isPlaying ? <Pause size={32} aria-hidden="true" /> : <Play size={32} aria-hidden="true" />}
                </button>
                <button onClick={onNextAyah} disabled={isLastAyah} title="Next Ayah" aria-label="Next Ayah" className="p-3 sm:p-4 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200">
                    <SkipForward size={24} aria-hidden="true" />
                </button>
                <button onClick={onNextSurah} disabled={isLastSurah} title="Next Surah" aria-label="Next Surah" className="p-3 sm:p-4 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200">
                    <ChevronsRight size={24} aria-hidden="true" />
                </button>
            </div>

            {/* Volume Control */}
            <div className="w-full max-w-xs flex items-center space-x-3 pt-2">
                <button onClick={onMuteToggle} title={isMuted ? "Unmute" : "Mute"} aria-label={isMuted ? "Unmute" : "Mute"} className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors duration-200">
                    {isMuted || volume === 0 ? <VolumeX size={20} aria-hidden="true" /> : <Volume2 size={20} aria-hidden="true" />}
                </button>
                <input
                    type="range"
                    min="0" max="1" step="0.01"
                    value={isMuted ? 0 : volume}
                    onChange={onVolumeChange}
                    className={`w-full h-2 rounded-lg appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-cyan-500 ${isMuted ? 'bg-slate-300 dark:bg-slate-600' : 'bg-slate-200 dark:bg-slate-700 accent-cyan-600'}`}
                    aria-label="Volume control"
                />
            </div>
        </div>
    );
});
PlayerControls.displayName = 'PlayerControls';


const SettingsPanel = memo(({
    continuousPlay, setContinuousPlay, arabicFontSize, englishFontSize, onFontSizeChange
}) => {
    const [isOpen, setIsOpen] = useState(false);

    const FontSizeControl = ({ type, change }) => {
        const Icon = change > 0 ? Plus : Minus;
        const label = ` ${change > 0 ? 'Increase' : 'Decrease'} ${type} font size`;
        return (
            <button onClick={() => onFontSizeChange(type, change)} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors" aria-label={label}>
                <Icon size={18} aria-hidden="true" />
            </button>
        );
    };

    return (
        <div className="relative max-w-lg mx-auto">
            <div className="flex justify-center">
                <button onClick={() => setIsOpen(o => !o)} className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors py-2 px-4 rounded-lg">
                    <Settings size={20} />
                    <span>Settings</span>
                </button>
            </div>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-4 border-t dark:border-slate-700/50 pt-6 px-2 flex flex-col items-center gap-6 text-sm">
                            {/* Font Size Controls */}
                            <div className="flex flex-col sm:flex-row justify-center items-center w-full gap-4">
                                <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 p-2 rounded-lg w-full sm:w-auto justify-between">
                                    <label className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Arabic Font</label>
                                    <div className="flex items-center gap-1">
                                        <FontSizeControl type="arabic" change={-0.125} />
                                        <span className="w-8 text-center font-mono">{(arabicFontSize * 10).toFixed(0)}</span>
                                        <FontSizeControl type="arabic" change={0.125} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 bg-slate-100 dark:bg-slate-700 p-2 rounded-lg w-full sm:w-auto justify-between">
                                    <label className="font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">English Font</label>
                                    <div className="flex items-center gap-1">
                                        <FontSizeControl type="english" change={-0.125} />
                                        <span className="w-8 text-center font-mono">{(englishFontSize * 10).toFixed(0)}</span>
                                        <FontSizeControl type="english" change={0.125} />
                                    </div>
                                </div>
                            </div>
                            {/* Continuous Play Toggle */}
                            <div className="flex justify-center items-center gap-4">
                                <label htmlFor="continuous-play" className="font-medium text-slate-700 dark:text-slate-300 cursor-pointer">Continuous Play</label>
                                <input
                                    type="checkbox"
                                    id="continuous-play"
                                    checked={continuousPlay}
                                    onChange={() => setContinuousPlay(p => !p)}
                                    className="h-6 w-11 rounded-full appearance-none bg-slate-300 dark:bg-slate-600 checked:bg-cyan-600 transition-colors duration-300 ease-in-out cursor-pointer relative after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-md after:transition-all after:duration-300 checked:after:translate-x-5 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 dark:ring-offset-slate-800"
                                    role="switch"
                                    aria-checked={continuousPlay}
                                />
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});
SettingsPanel.displayName = 'SettingsPanel';


// --- Main Quran Player Component ---
const QuranPlayer = () => {
    const {
        surahs, audioEditions, selectedSurahNum, selectedEditionId, surahData,
        currentAyahIndex, isPlaying, isLoading, error, isMuted, volume,
        continuousPlay, arabicFontSize, englishFontSize, audioProgress, audioRef,
        setSelectedSurahNum, setSelectedEditionId, togglePlayPause, handleNextAyah,
        handlePrevAyah, handleNextSurah, handlePrevSurah, handleSeek, handleVolumeChange,
        toggleMute, setContinuousPlay, handleFontSizeChange,
    } = useQuranPlayer();

    const surahOptions = surahs.map(s => ({ value: s.number, label: `${s.number}. ${s.englishName} (${s.name})` }));
    const editionOptions = audioEditions.map(e => ({ value: e.identifier, label: `${e.englishName} (${e.name})` }));

    const currentSurah = surahs.find(s => s.number === selectedSurahNum);
    const currentAyah = surahData?.ayahs[currentAyahIndex];
    
    const isFirstOverallAyah = selectedSurahNum === 1 && currentAyahIndex === 0;
    const isLastOverallAyah = selectedSurahNum === TOTAL_SURAHS && (!surahData || currentAyahIndex === surahData.ayahs.length - 1);

    return (
        <div className="p-2 sm:p-6 md:p-8 w-full">
            <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl p-4 sm:p-8 rounded-2xl shadow-2xl shadow-cyan-500/10 ring-1 ring-black/5 w-full max-w-3xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <CustomSelect options={surahOptions} value={selectedSurahNum} onChange={setSelectedSurahNum} placeholder="Select Surah" searchEnabled />
                    <CustomSelect options={editionOptions} value={selectedEditionId} onChange={setSelectedEditionId} placeholder="Select Reciter" searchEnabled />
                </div>

                {error ? <ErrorDisplay message={error} /> : (isLoading && !surahData) ? <SkeletonLoader /> : (
                    <>
                        <AyahDisplay surah={currentSurah} ayah={currentAyah} arabicFontSize={arabicFontSize} englishFontSize={englishFontSize} />
                        
                        <div className="mt-6">
                             <SettingsPanel
                                continuousPlay={continuousPlay}
                                setContinuousPlay={setContinuousPlay}
                                arabicFontSize={arabicFontSize}
                                englishFontSize={englishFontSize}
                                onFontSizeChange={handleFontSizeChange}
                            />
                        </div>

                        <div className="mt-6 border-t dark:border-slate-700/50">
                            <PlayerControls
                                isPlaying={isPlaying}
                                onPlayPause={togglePlayPause}
                                onNextAyah={handleNextAyah}
                                onPrevAyah={handlePrevAyah}
                                onNextSurah={handleNextSurah}
                                onPrevSurah={handlePrevSurah}
                                isFirstAyah={isFirstOverallAyah}
                                isLastAyah={isLastOverallAyah && !continuousPlay}
                                isFirstSurah={selectedSurahNum === 1}
                                isLastSurah={selectedSurahNum === TOTAL_SURAHS}
                                volume={volume}
                                onVolumeChange={handleVolumeChange}
                                isMuted={isMuted}
                                onMuteToggle={toggleMute}
                                audioProgress={audioProgress}
                                onSeek={handleSeek}
                            />
                        </div>
                    </>
                )}
                <audio ref={audioRef} preload="metadata" />
            </div>
        </div>
    );
};

// --- Main App Component ---
const App = () => {
    return (
        <div className="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 min-h-screen font-['Inter',_sans-serif] flex flex-col items-center">
            <div className="fixed inset-0 w-full h-full bg-gradient-to-br from-cyan-50 via-slate-50 to-teal-50 dark:from-slate-900 dark:via-slate-800/95 dark:to-black -z-10"></div>

            <header className="w-full bg-white/70 dark:bg-slate-800/70 backdrop-blur-lg shadow-sm sticky top-0 z-30 p-4 border-b border-slate-200 dark:border-slate-700/50">
                <div className="max-w-6xl mx-auto flex justify-center items-center">
                    <h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-600 to-teal-500">
                        Tarteel
                        <span className="text-lg sm:text-xl font-normal text-slate-400 ml-2">ترتيل</span>
                    </h1>
                </div>
            </header>

            <main className="flex-grow w-full flex justify-center items-center py-4 sm:py-6">
                <AnimatePresence mode="wait">
                    <motion.div
                        key="quran-player"
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -20, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="w-full"
                    >
                        <QuranPlayer />
                    </motion.div>
                </AnimatePresence>
            </main>

            <footer className="text-center p-6 text-sm text-slate-500 dark:text-slate-400 mt-auto">
                <p>Data from <a href="https://alquran.cloud/api" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-500 underline underline-offset-2">alquran.cloud</a>.</p>
            </footer>
        </div>
    );
};

export default App;
