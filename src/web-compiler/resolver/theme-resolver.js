'use strict';

/**
 * Theme + polish profile resolver — step 9.
 *
 * Validates that the site's theme_id and polish_profile_id exist in the
 * theme pack, and returns the resolved theme manifest and polish profile
 * object.  Throws with error codes theme_not_found | polish_profile_not_supported.
 */

/**
 * @param {object} siteDef   site_definition_v5
 * @param {object} themePack theme-pack.sample.json
 * @returns {{ themeManifest, polishProfile, tokens, guardrails }}
 */
function resolveTheme(siteDef, themePack) {
    const { theme_id, polish_profile_id } = siteDef.site;

    // Validate theme
    if (themePack.manifest.theme_id !== theme_id) {
        const err = new Error(`Theme "${theme_id}" not found in theme pack`);
        err.code = 'theme_not_found';
        throw err;
    }

    // Validate polish profile
    const polishProfile = (themePack.polish_profiles || []).find(p => p.id === polish_profile_id);
    if (!polishProfile) {
        const err = new Error(
            `Polish profile "${polish_profile_id}" not supported by theme "${theme_id}". ` +
            `Supported: ${(themePack.manifest.supported_polish_profiles || []).join(', ')}`
        );
        err.code = 'polish_profile_not_supported';
        throw err;
    }

    return {
        themeManifest:  themePack.manifest,
        polishProfile,
        tokens:         themePack.tokens || {},
        guardrails:     themePack.guardrails || {},
    };
}

module.exports = { resolveTheme };
