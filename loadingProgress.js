// Drives a progress bar inside #loadingScreen from the download progress of several assets.
//
//   const progress = createLoadingProgress();
//   progress.track((onProgress) => someLoader.load(url, resolve, onProgress, reject)); // returns a promise
//   ...
//   progress.finish();  // when the loading screen is about to fade out

// Downloading accounts for this much of the bar. The rest is decoding, scene setup and the
// first frame, which only complete when finish() is called.
const DOWNLOAD_SHARE = 0.92;

export function createLoadingProgress() {

    const fill = document.querySelector(".loadingBarFill");

    const tasks = [];
    let shown = 0;
    let queued = false;

    function render(p) {
        shown = Math.max(shown, Math.min(1, p));
        fill.style.transform = `scaleX(${shown})`;
    }

    function update() {
        // Weight each asset by its size once known; assets whose size isn't known yet count as
        // the average of the known ones, so a big file doesn't look like a small one.
        const known = tasks.filter((t) => t.total > 0);
        const avg = known.length ? known.reduce((s, t) => s + t.total, 0) / known.length : 1;
        let done = 0;
        let weight = 0;
        for (const t of tasks) {
            const w = t.total > 0 ? t.total : avg;
            // Decoding/transcoding starts after the last byte arrives, so downloading counts for 90%.
            const f = t.done ? 1 : t.total > 0 ? Math.min(t.loaded / t.total, 1) * 0.9 : 0;
            done += w * f;
            weight += w;
        }
        render(weight ? (done / weight) * DOWNLOAD_SHARE : 0);
    }

    // Progress events can fire thousands of times for large files; update at most once per frame.
    function schedule() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            update();
        });
    }

    return {
        // start(onProgress) must begin a load and return its promise.
        track(start) {
            const t = { loaded: 0, total: 0, done: false };
            tasks.push(t);
            return start((e) => {
                t.loaded = e.loaded;
                t.total = e.total; // 0 when the server sends no Content-Length
                schedule();
            }).then((result) => {
                t.done = true;
                schedule();
                return result;
            });
        },
        finish() {
            render(1);
        },
    };
}