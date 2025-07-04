// src/apiService.js

// This service centralizes all API calls for a cleaner codebase.
const API_BASE_URL = 'https://api.alquran.cloud/v1';

/**
 * A helper to handle API responses consistently and parse errors.
 * @param {Response} response - The fetch API response.
 * @returns {Promise<object>} The JSON data.
 */
const handleResponse = async (response) => {
    const data = await response.json();
    if (!response.ok || data.code !== 200) {
        // Use the API's error message if available, otherwise use a default.
        throw new Error(data.data || `Request failed with status ${response.status}`);
    }
    return data.data;
};

/**
 * Fetches the core metadata for the app (lists of surahs, juz, pages, etc.).
 */
export const fetchMetaData = async () => {
    const response = await fetch(`${API_BASE_URL}/meta`);
    return handleResponse(response);
};

/**
 * Fetches the list of available text translations for a given language.
 * @param {string} language - The 2-digit language code (e.g., 'en', 'fr').
 */
export const fetchAvailableTranslations = async (language = 'en') => {
    const response = await fetch(`${API_BASE_URL}/edition?language=${language}&type=translation&format=text`);
    return handleResponse(response);
};

/**
 * Fetches Quran content based on the selected mode (surah, juz, page).
 * @param {object} params - The parameters for the fetch call.
 */
export const fetchContentData = async ({ mode, number, audioEdition, textEdition }) => {
    const editions = `${audioEdition},quran-uthmani,${textEdition}`;
    const url = `${API_BASE_URL}/${mode}/${number}/editions/${editions}`;
    
    const response = await fetch(url);
    // The handleResponse function is not used here because the structure is different (an array of editions)
    const json = await response.json();
     if (!response.ok || json.code !== 200) {
        throw new Error(json.data || `Could not fetch data for ${mode} ${number}.`);
    }
    const data = json.data;

    const audioData = data.find(d => d.identifier === audioEdition);
    const textData = data.find(d => d.identifier === 'quran-uthmani');
    const translationData = data.find(d => d.identifier === textEdition);

    if (!audioData || !textData || !translationData) {
        throw new Error('One or more required editions are missing for this selection.');
    }
    
    const combinedAyahs = audioData.ayahs.map((ayah, i) => ({
        ...ayah,
        textArabic: textData.ayahs[i]?.text || 'Not available.',
        textEnglish: translationData.ayahs[i]?.text || 'Not available.',
    }));
    
    // Use the edition's top-level info, which is consistent for the whole request.
    const entityInfo = {
        number: audioData.number,
        name: audioData.name,
        englishName: audioData.englishName,
        englishNameTranslation: audioData.englishNameTranslation,
        revelationType: audioData.revelationType,
        numberOfAyahs: audioData.numberOfAyahs,
    };

    return { ...entityInfo, ayahs: combinedAyahs, edition: audioData.edition };
};

/**
 * Searches the Quran for a specific keyword.
 * @param {string} keyword - The search term.
 * @param {string} language - The 2-digit language code to search in.
 */
export const searchQuran = async (keyword, language = 'en') => {
    const url = `${API_BASE_URL}/search/${encodeURIComponent(keyword)}/all/${language}`;
    const response = await fetch(url);
    return handleResponse(response);
};