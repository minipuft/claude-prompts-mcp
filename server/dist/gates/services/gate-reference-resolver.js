/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, () => Array.from({ length: a.length + 1 }, () => 0));
    const firstRow = matrix[0];
    if (!firstRow) {
        return 0;
    }
    for (let i = 0; i <= a.length; i++) {
        firstRow[i] = i;
    }
    for (let j = 0; j <= b.length; j++) {
        const currentRow = matrix[j];
        if (currentRow) {
            currentRow[0] = j;
        }
    }
    for (let j = 1; j <= b.length; j++) {
        const currentRow = matrix[j];
        const previousRow = matrix[j - 1];
        if (!currentRow || !previousRow) {
            continue;
        }
        for (let i = 1; i <= a.length; i++) {
            const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
            const left = currentRow[i - 1];
            const top = previousRow[i];
            const diagonal = previousRow[i - 1];
            if (left === undefined || top === undefined || diagonal === undefined) {
                continue;
            }
            currentRow[i] = Math.min(left + 1, top + 1, diagonal + indicator);
        }
    }
    const lastRow = matrix[b.length];
    if (!lastRow) {
        return 0;
    }
    return lastRow[a.length] ?? 0;
}
/**
 * Resolves inline gate references by checking whether they match
 * canonical gate definitions or should remain inline criteria.
 *
 * Gate resolution is now fully dynamic - gates are identified by loading
 * from the definitions directory via GateLoader. No hardcoded gate sets.
 *
 * Includes fuzzy matching to suggest similar gate IDs for typos.
 */
export class GateReferenceResolver {
    constructor(gateLoader) {
        this.gateLoader = gateLoader;
        this.cache = new Map();
    }
    async resolve(reference) {
        const normalized = reference.trim();
        if (!normalized) {
            return { referenceType: 'inline', criteria: '' };
        }
        const cached = this.cache.get(normalized);
        if (cached) {
            return cached;
        }
        const resolution = await this.computeResolution(normalized);
        this.cache.set(normalized, resolution);
        return resolution;
    }
    async computeResolution(value) {
        if (this.isGateSlug(value)) {
            const candidateIds = this.buildCandidates(value);
            for (const candidate of candidateIds) {
                const gate = await this.gateLoader.loadGate(candidate);
                if (gate) {
                    return {
                        referenceType: 'registered',
                        gateId: gate.id,
                    };
                }
            }
            // No exact match found - check for fuzzy matches if this looks like a gate ID
            const suggestions = await this.findSuggestions(value);
            if (suggestions.length > 0) {
                return {
                    referenceType: 'inline',
                    criteria: value,
                    suggestions,
                };
            }
        }
        return {
            referenceType: 'inline',
            criteria: value,
        };
    }
    /**
     * Find similar gate IDs using fuzzy matching (Levenshtein distance)
     * Returns suggestions for typos within edit distance of 3
     */
    async findSuggestions(value) {
        const availableGates = await this.gateLoader.listAvailableGates();
        const valueLower = value.toLowerCase();
        const suggestions = availableGates
            .map((gateId) => ({
            gateId,
            distance: levenshteinDistance(valueLower, gateId.toLowerCase()),
        }))
            .filter((item) => item.distance <= 3 && item.distance > 0)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 3)
            .map((item) => item.gateId);
        return suggestions;
    }
    isGateSlug(value) {
        return /^[A-Za-z0-9_-]+$/.test(value);
    }
    buildCandidates(value) {
        const lowerCase = value.toLowerCase();
        if (value === lowerCase) {
            return [value];
        }
        return [value, lowerCase];
    }
}
//# sourceMappingURL=gate-reference-resolver.js.map