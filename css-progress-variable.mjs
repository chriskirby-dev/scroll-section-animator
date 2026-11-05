class CSSProgressVariable {
    static easings = {
        linear: (t) => `calc(${t})`,

        easeInQuad: (t) => `calc(pow(${t}, 2))`,

        easeOutQuad: (t) => `calc(1 - pow(1 - ${t}, 2))`,

        easeInOutQuad: (t) =>
            `calc(
                2 * pow(${t}, 2)
                - pow(max(0, 2 * ${t} - 1), 2)
            )`,

        easeInCubic: (t) => `calc(pow(${t}, 3))`,

        easeOutCubic: (t) => `calc(1 - pow(1 - ${t}, 3))`,

        easeInSine: (t) => `calc(1 - cos(${t} * 90deg))`,

        easeOutSine: (t) => `calc(sin(${t} * 90deg))`,

        smoothstep: (t) => `calc(${t} * ${t} * (3 - 2 * ${t}))`
    };

    static easingValues = {
        linear: (t) => t,
        easeInQuad: (t) => t ** 2,
        easeOutQuad: (t) => 1 - (1 - t) ** 2,
        easeInOutQuad: (t) => 2 * t ** 2 - Math.max(0, 2 * t - 1) ** 2,
        easeInCubic: (t) => t ** 3,
        easeOutCubic: (t) => 1 - (1 - t) ** 3,
        easeInSine: (t) => 1 - Math.cos(t * Math.PI * 0.5),
        easeOutSine: (t) => Math.sin(t * Math.PI * 0.5),
        smoothstep: (t) => t * t * (3 - 2 * t)
    };

    constructor(variable, min = 0, max = 1, { current = null } = {}) {
        this.variable = this.normalizeName(variable);
        this.min = min;
        this.max = max;
        this.currentResolver = typeof current === "function" ? current : null;
    }

    normalizeName(name) {
        return name.startsWith("--") ? name : `--${name}`;
    }

    get value() {
        return `var(${this.variable})`;
    }

    createValue(value, metadata = {}, currentResolver = null) {
        const result = {
            ...metadata,
            value,
            keyframes: (frames, options = {}) =>
                this.createKeyframeValue(value, frames, options, () => result.current)
        };

        Object.defineProperty(result, "current", {
            enumerable: true,
            get: () => currentResolver?.() ?? null
        });

        return result;
    }

    /**
     * Create a normalized subset.
     *
     * @param {number} inPoint
     * @param {number} outPoint
     * @param {string|function} easing
     */
    slice(inPoint, outPoint, easing = "linear") {
        if (inPoint === outPoint) {
            throw new RangeError("A progress slice requires different in and out points.");
        }

        const progress = `clamp(
            0,
            (${this.value} - ${inPoint}) / (${outPoint} - ${inPoint}),
            1
        )`;

        const eased = this.applyEasing(progress, easing);

        return this.createValue(
            eased,
            {
                inPoint,
                outPoint,
                easing,
                progress
            },
            () => {
                const current = Number(this.current);
                if (!Number.isFinite(current)) return null;

                const normalized = Math.max(0, Math.min(1, (current - inPoint) / (outPoint - inPoint)));
                return this.applyEasingValue(normalized, easing);
            }
        );
    }

    /**
     * Map progress through a set of CSS-compatible keyframe values.
     *
     * Progress values are normalized numbers from 0 to 1. The generated value
     * is a CSS-only piecewise expression which holds the first and last values
     * outside their declared progress range.
     *
     * @param {Array<{progress:number,value:number|string}>} frames
     * @param {{easing?: string|function}} options
     */
    keyframes(frames, options = {}) {
        return this.createKeyframeValue(this.value, frames, options, () => this.current);
    }

    createKeyframeValue(progress, frames, { easing = "linear" } = {}, currentResolver = null) {
        const normalizedFrames = this.normalizeKeyframes(frames);
        const terms = [normalizedFrames[0].value];

        for (let index = 1; index < normalizedFrames.length; index++) {
            const previous = normalizedFrames[index - 1];
            const current = normalizedFrames[index];
            const segmentProgress = `clamp(
                0,
                (${progress} - ${previous.progress}) / (${current.progress} - ${previous.progress}),
                1
            )`;
            const easedSegment = this.applyEasing(segmentProgress, easing);

            terms.push(`(${current.value} - ${previous.value}) * ${easedSegment}`);
        }

        return this.createValue(
            `calc(${terms.join(" + ")})`,
            {
                easing,
                frames: normalizedFrames,
                progress
            },
            () => this.resolveKeyframeValue(currentResolver?.(), normalizedFrames, easing)
        );
    }

    normalizeKeyframes(frames) {
        if (!Array.isArray(frames)) {
            throw new TypeError("Progress keyframes must be an array of { progress, value } objects.");
        }

        if (frames.length < 2) {
            throw new RangeError("Progress keyframes require at least two values.");
        }

        const normalized = frames.map((frame, index) => {
            if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
                throw new TypeError(`Progress keyframe ${index} must be an object.`);
            }

            const progress = Number(frame.progress);
            if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
                throw new RangeError(`Progress keyframe ${index} must have progress between 0 and 1.`);
            }

            return {
                progress,
                value: this.normalizeKeyframeValue(frame.value)
            };
        });

        normalized.sort((a, b) => a.progress - b.progress);

        for (let index = 1; index < normalized.length; index++) {
            if (normalized[index].progress === normalized[index - 1].progress) {
                throw new RangeError(`Progress keyframes contain duplicate progress ${normalized[index].progress}.`);
            }
        }

        return normalized;
    }

    normalizeKeyframeValue(value) {
        if (typeof value === "number") {
            if (Number.isFinite(value)) return value;
        } else if (typeof value === "string" && value.trim()) {
            return value.trim();
        }

        throw new TypeError("Progress keyframe values must be finite numbers or non-empty CSS values.");
    }

    resolveKeyframeValue(progress, frames, easing) {
        const current = Number(progress);
        if (!Number.isFinite(current)) return null;
        if (current <= frames[0].progress) return frames[0].value;
        if (current >= frames.at(-1).progress) return frames.at(-1).value;

        for (let index = 1; index < frames.length; index++) {
            const previous = frames[index - 1];
            const next = frames[index];
            if (current > next.progress) continue;

            const segment = (current - previous.progress) / (next.progress - previous.progress);
            const eased = this.applyEasingValue(segment, easing);
            return eased === null ? null : this.interpolateValue(previous.value, next.value, eased);
        }

        return null;
    }

    interpolateValue(from, to, progress) {
        if (typeof from === "number" && typeof to === "number") {
            return from + (to - from) * progress;
        }

        const parse = (value) => String(value).match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
        const start = parse(from);
        const end = parse(to);
        if (!start || !end || start[2] !== end[2]) return null;

        return `${Number(start[1]) + (Number(end[1]) - Number(start[1])) * progress}${start[2]}`;
    }

    applyEasing(progress, easing) {
        if (typeof easing === "function") {
            return easing(progress);
        }

        const fn = CSSProgressVariable.easings[easing];

        if (!fn) {
            throw new Error(`Unknown easing "${easing}"`);
        }

        return fn(progress);
    }

    applyEasingValue(progress, easing) {
        if (typeof easing === "function") {
            const value = easing(progress);
            return Number.isFinite(value) ? value : null;
        }

        const fn = CSSProgressVariable.easingValues[easing];
        return fn ? fn(progress) : null;
    }

    get css() {
        return `${this.variable}: ${this.min};`;
    }

    get current() {
        if (this.currentResolver) return this.currentResolver();
        return getComputedStyle(document.documentElement).getPropertyValue(this.variable).trim();
    }
}

export default CSSProgressVariable;
