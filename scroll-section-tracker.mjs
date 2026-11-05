import CSSProgressVariable from "./css-progress-variable.mjs";

class ScrollSectionTracker {
    constructor({
        container,
        attribute = "scroll-id",
        root = document.documentElement,
        styleSheetId = null,
        progressVariable = "--scroll-progress",
        progressSource = null
    } = {}) {
        if (!container) {
            throw new Error("ScrollSectionTracker requires a scroll container.");
        }

        this.container = container;
        this.attribute = attribute;
        this.selector = `[${attribute}]`;
        this.variables = new Map();
        this.root = root;
        this.styleSheetId = styleSheetId;

        this.progressVariable = this.normalizeVariable(progressVariable);
        this.progressSource = progressSource ?? container.closest?.("scroll-view") ?? null;
        this.currentProgress = 0;

        this.elements = new Map();
        this.sections = new Map();

        this.measureFrame = null;

        /*
         * If a stylesheet ID is supplied, write variables
         * into a :root rule in that stylesheet.
         *
         * Otherwise write directly to root.style.
         */
        this.styleTarget = styleSheetId ? this.getStyleRule(styleSheetId).style : root.style;

        /*
         * Any tracked section changing size can change the
         * position of every section below it, so always
         * remeasure all sections.
         */
        this.resizeObserver = new ResizeObserver(() => {
            this.scheduleMeasure();
        });

        /*
         * Detect scroll-id elements being added, removed,
         * or having their scroll-id changed.
         */
        this.mutationObserver = new MutationObserver((mutations) => {
            this.handleMutations(mutations);
        });

        this.init();
    }

    /* =========================================================
       VARIABLE HELPERS
    ========================================================= */

    normalizeVariable(variable) {
        if (typeof variable === "string" && variable.startsWith("--")) {
            return variable;
        }

        return `--${variable}`;
    }

    getPrefix(id) {
        return `--scroll-${id}`;
    }

    /* =========================================================
       STYLE TARGET
    ========================================================= */

    getStyleRule(id) {
        let styleElement = document.getElementById(id);

        /*
         * Create stylesheet if it doesn't exist.
         */
        if (!styleElement) {
            styleElement = document.createElement("style");

            styleElement.id = id;
            styleElement.textContent = ":root {}";

            document.head.appendChild(styleElement);
        }

        const sheet = styleElement.sheet;

        if (!sheet) {
            throw new Error(`Unable to access stylesheet "${id}".`);
        }

        /*
         * Reuse existing :root rule.
         */
        for (const rule of sheet.cssRules) {
            if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
                return rule;
            }
        }

        /*
         * Otherwise create one.
         */
        const index = sheet.insertRule(":root {}", sheet.cssRules.length);

        return sheet.cssRules[index];
    }

    setStyle(id, selector, properties) {
        let styleElement = document.getElementById(id);
    }

    getScopedVariable(id) {
        return new CSSProgressVariable(`${this.getPrefix(id)}-progress`, 0, 1, {
            current: () => this.getProgress(id)
        });
    }

    getMasterVariable() {
        return new CSSProgressVariable(this.progressVariable, 0, 1, {
            current: () => this.currentProgress
        });
    }

    setVariable(variable, value) {
        const normalized = this.normalizeVariable(variable);
        this.variables.set(normalized, value);
        this.styleTarget.setProperty(normalized, value);
        return this;
    }

    removeVariable(variable) {
        const normalized = this.normalizeVariable(variable);
        this.variables.delete(normalized);
        this.styleTarget.removeProperty(normalized);

        return this;
    }

    /* =========================================================
       INITIALIZATION
    ========================================================= */

    init() {
        /*
         * Discover all existing scroll sections.
         */
        this.scan();

        /*
         * Watch DOM for dynamically added/removed sections.
         */
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [this.attribute]
        });

        /*
         * Browser resize changes scroll geometry.
         */
        window.addEventListener("resize", this.handleResize);

        /*
         * Run again once external resources have loaded.
         */
        window.addEventListener("load", this.handleLoad);

        this.progressSource?.addEventListener?.("scroll-y", this.handleScroll);

        this.scheduleMeasure();
    }

    /* =========================================================
       SCANNING
    ========================================================= */

    scan(parent = document) {
        /*
         * Parent itself may be a scroll section.
         */
        if (parent instanceof Element && parent.matches(this.selector)) {
            this.register(parent);
        }

        /*
         * Find descendants.
         */
        parent.querySelectorAll?.(this.selector).forEach((element) => {
            this.register(element);
        });
    }

    /* =========================================================
       REGISTRATION
    ========================================================= */

    register(element) {
        if (this.elements.has(element)) {
            return;
        }

        const id = element.getAttribute(this.attribute);

        if (!id) {
            return;
        }

        const data = {
            id,
            element,
            top: 0,
            height: 0,
            start: 0,
            end: 0
        };

        this.elements.set(element, data);
        this.sections.set(id, data);

        /*
         * Automatically create all derived section
         * timeline variables.
         */
        this.createSectionVariables(id);

        /*
         * Watch this section for size changes.
         */
        this.resizeObserver.observe(element);

        this.scheduleMeasure();
    }

    unregister(element) {
        const data = this.elements.get(element);

        if (!data) {
            return;
        }

        this.resizeObserver.unobserve(element);

        this.removeSectionVariables(data.id);

        this.elements.delete(element);
        if (this.sections.get(data.id) === data) {
            this.sections.delete(data.id);
        }

        this.scheduleMeasure();
    }

    /* =========================================================
       AUTOMATIC SECTION VARIABLES
    ========================================================= */

    createSectionVariables(id) {
        const prefix = this.getPrefix(id);

        const start = `${prefix}-start`;

        const end = `${prefix}-end`;

        const progress = `${prefix}-progress`;

        const entered = `${prefix}-entered`;

        const passed = `${prefix}-passed`;

        const active = `${prefix}-active`;

        /*
         * Normalized section progress.
         *
         * Before section:
         * 0
         *
         * Inside section:
         * 0 -> 1
         *
         * After section:
         * 1
         */
        this.setVariable(
            progress,
            `clamp(
                0,
                (
                    var(${this.progressVariable})
                    -
                    var(${start})
                )
                /
                (
                    var(${end})
                    -
                    var(${start})
                ),
                1
            )`
        );

        /*
         * 0 before section start
         * 1 once section has been entered
         */
        this.setVariable(
            entered,
            `clamp(
                0,
                sign(
                    var(${this.progressVariable})
                    -
                    var(${start})
                ) + 1,
                1
            )`
        );

        /*
         * 0 before section end
         * 1 once section has passed
         */
        this.setVariable(
            passed,
            `clamp(
                0,
                sign(
                    var(${this.progressVariable})
                    -
                    var(${end})
                ) + 1,
                1
            )`
        );

        /*
         * 1 only while the master scroll progress
         * is inside this section's range.
         */
        this.setVariable(
            active,
            `calc(
                var(${entered})
                -
                var(${passed})
            )`
        );
    }

    /* =========================================================
       MEASUREMENT
    ========================================================= */

    measure(element) {
        const data = this.elements.get(element);

        if (!data) {
            return;
        }

        const top = this.getPositionInContainer(element);

        const height = element.offsetHeight;

        const bottom = top + height;

        /*
         * Total usable scroll distance.
         *
         * This needs to match the coordinate system used
         * by your smooth scroll system.
         */
        const scrollRange = this.container.scrollHeight - window.innerHeight;

        if (scrollRange <= 0) {
            data.top = top;
            data.height = height;
            data.start = 0;
            data.end = 0;
            return;
        }

        const start = top / scrollRange;

        const end = bottom / scrollRange;

        data.top = top;
        data.height = height;
        data.start = start;
        data.end = end;

        const prefix = this.getPrefix(data.id);

        this.setVariable(`${prefix}-start`, start);

        this.setVariable(`${prefix}-end`, end);

        this.setVariable(`${prefix}-top`, `${top}px`);

        this.setVariable(`${prefix}-height`, `${height}px`);
    }

    measureAll() {
        for (const element of this.elements.keys()) {
            this.measure(element);
        }
    }

    /* =========================================================
       POSITION
    ========================================================= */

    getPositionInContainer(element) {
        let top = 0;

        let current = element;

        /*
         * Walk the offsetParent chain until we reach
         * the configured scroll container.
         *
         * This gives us static layout coordinates and
         * ignores virtual/smooth scroll transforms.
         */
        while (current && current !== this.container) {
            top += current.offsetTop;

            current = current.offsetParent;
        }

        /*
         * Some layouts may not have the configured
         * container in the offsetParent chain.
         *
         * Fall back to relative bounding rectangles.
         */
        if (current !== this.container) {
            const elementRect = element.getBoundingClientRect();

            const containerRect = this.container.getBoundingClientRect();

            top = elementRect.top - containerRect.top;
        }

        return top;
    }

    /* =========================================================
       SCHEDULING
    ========================================================= */

    scheduleMeasure() {
        /*
         * Only allow one measurement pass per frame.
         */
        if (this.measureFrame !== null) {
            return;
        }

        this.measureFrame = requestAnimationFrame(() => {
            this.measureAll();

            this.measureFrame = null;
        });
    }

    handleResize = () => {
        this.scheduleMeasure();
    };

    handleLoad = () => {
        this.scheduleMeasure();
    };

    handleScroll = (event) => {
        this.setProgress(event.detail?.percent);
    };

    /* =========================================================
       DOM MUTATIONS
    ========================================================= */

    handleMutations(mutations) {
        let needsMeasure = false;

        for (const mutation of mutations) {
            /*
             * scroll-id changed or removed.
             */
            if (mutation.type === "attributes") {
                const element = mutation.target;

                const existing = this.elements.get(element);

                const id = element.getAttribute(this.attribute);

                /*
                 * Element still has a scroll-id.
                 */
                if (id) {
                    /*
                     * Existing section changed ID.
                     */
                    if (existing && existing.id !== id) {
                        this.removeSectionVariables(existing.id);

                        if (this.sections.get(existing.id) === existing) {
                            this.sections.delete(existing.id);
                        }

                        existing.id = id;

                        this.sections.set(id, existing);

                        this.createSectionVariables(id);
                    } else if (!existing) {
                        /*
                         * New tracked element.
                         */
                        this.register(element);
                    }
                } else if (existing) {
                    /*
                     * Attribute removed.
                     */
                    this.unregister(element);
                }

                needsMeasure = true;

                continue;
            }

            /* =================================================
               ADDED ELEMENTS
            ================================================= */

            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                this.scan(node);

                needsMeasure = true;
            }

            /* =================================================
               REMOVED ELEMENTS
            ================================================= */

            for (const node of mutation.removedNodes) {
                if (!(node instanceof Element)) {
                    continue;
                }

                this.unregisterTree(node);

                needsMeasure = true;
            }
        }

        if (needsMeasure) {
            this.scheduleMeasure();
        }
    }

    unregisterTree(node) {
        /*
         * Node itself.
         */
        if (this.elements.has(node)) {
            this.unregister(node);
        }

        /*
         * Any tracked descendants.
         */
        node.querySelectorAll?.(this.selector).forEach((element) => {
            if (this.elements.has(element)) {
                this.unregister(element);
            }
        });
    }

    /* =========================================================
       CLEANUP VARIABLES
    ========================================================= */

    removeSectionVariables(id) {
        const prefix = this.getPrefix(id);

        const variables = [
            `${prefix}-start`,
            `${prefix}-end`,
            `${prefix}-top`,
            `${prefix}-height`,
            `${prefix}-progress`,
            `${prefix}-entered`,
            `${prefix}-passed`,
            `${prefix}-active`
        ];

        for (const variable of variables) {
            this.removeVariable(variable);
        }
    }

    /* =========================================================
       PUBLIC API
    ========================================================= */

    refresh() {
        this.scheduleMeasure();

        return this;
    }

    setProgress(value) {
        const progress = Number(value);

        if (Number.isFinite(progress)) {
            this.currentProgress = Math.max(0, Math.min(1, progress));
        }

        return this;
    }

    getProgress(id) {
        const section = this.sections.get(id);

        if (!section || section.end === section.start) {
            return 0;
        }

        return Math.max(
            0,
            Math.min(1, (this.currentProgress - section.start) / (section.end - section.start))
        );
    }

    get(id) {
        return this.sections.get(id)?.element ?? null;
    }

    has(id) {
        return this.sections.has(id);
    }

    destroy() {
        window.removeEventListener("resize", this.handleResize);

        window.removeEventListener("load", this.handleLoad);

        this.progressSource?.removeEventListener?.("scroll-y", this.handleScroll);

        this.resizeObserver.disconnect();

        this.mutationObserver.disconnect();

        if (this.measureFrame !== null) {
            cancelAnimationFrame(this.measureFrame);

            this.measureFrame = null;
        }

        this.elements.clear();
        this.sections.clear();
    }
}

export default ScrollSectionTracker;
