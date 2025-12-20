const fs = require("fs");
const fsp = require("fs/promises");
const ffmpeg = require("fluent-ffmpeg");
const path = require("path");

async function processVideo() {
    const configPath = path.join(__dirname, "config.json");
    if (!fs.existsSync(configPath)) {
        console.error("❌ Missing config.json!");
        return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { directory, id, cuts, volume, fadeDuration } = config;

    if (!Array.isArray(cuts) || cuts.length === 0) {
        console.error("❌ Config must include a non-empty cuts array.");
        return;
    }

    const fadeIn = fadeDuration.in ?? 0;
    const fadeOut = fadeDuration.out ?? 0;
    const crossfade = fadeDuration.crossfade ?? 0;

    const baseDir = path.join(__dirname, "..", directory, id);
    const inputVideo = path.join(baseDir, "video.mp4");
    const inputVoice = path.join(baseDir, "voice.wav");
    const output = path.join(baseDir, "output.mp4");

    if (!fs.existsSync(inputVideo) || !fs.existsSync(inputVoice)) {
        console.error("❌ Missing input video or voice file.");
        return;
    }

    // Place a copy of the config in the output folder for reference. 
    console.log("📄 Saving config to output folder...");
    await fsp.writeFile(
        path.join(baseDir, "config.json"),
        JSON.stringify(config, null, 2),
        "utf8"
    );

    // Check if the folder we are calling to has a script and if it does then run it. 
    if (fs.existsSync(path.join(__dirname, "..", directory, "script.js"))) {
        const script = require(path.join(__dirname, "..", directory, "script.js"));
        await script(config);
    }

    function toSeconds(ts) {
        const p = ts.split(":").map(Number);
        if (p.length !== 3) throw new Error("Timestamp must be HH:MM:SS");
        return p[0] * 3600 + p[1] * 60 + p[2];
    }

    const cmd = ffmpeg();

    // ---------- PRE-SEEKED INPUTS ----------
    const durations = [];

    cuts.forEach(cut => {
        const start = toSeconds(cut.start);
        const end = toSeconds(cut.end);
        const dur = end - start;

        if (dur <= 0) throw new Error("❌ Cut end must be after start");

        durations.push(dur);

        cmd.input(inputVideo).inputOptions([`-ss ${start}`, `-t ${dur}`]);
        cmd.input(inputVoice).inputOptions([`-ss ${start}`, `-t ${dur}`]);
    });

    const filter = [];
    let vLast = null;
    let aLast = null;
    let vaLast = null;

    cuts.forEach((_, i) => {
        const vIn = i * 2;
        const aIn = i * 2 + 1;
        const dur = durations[i];

        filter.push(
            `[${vIn}:v]setpts=PTS-STARTPTS,` +
            `fade=t=in:st=0:d=${fadeIn},` +
            `fade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}[v${i}]`
        );

        filter.push(`[${vIn}:a]asetpts=PTS-STARTPTS[a${i}]`);
        filter.push(`[${aIn}:a]asetpts=PTS-STARTPTS[va${i}]`);

        if (i === 0) {
            vLast = `v${i}`;
            aLast = `a${i}`;
            vaLast = `va${i}`;
            return;
        }

        // ---------- VIDEO CROSSFADE ----------
        filter.push(
            `[${vLast}][v${i}]xfade=transition=fade:duration=${crossfade}:offset=${durations
                .slice(0, i)
                .reduce((a, b) => a + b, 0) - crossfade}[vxf${i}]`
        );

        // ---------- AUDIO CROSSFADE ----------
        filter.push(
            `[${aLast}][a${i}]acrossfade=d=${crossfade}[axf${i}]`
        );

        filter.push(
            `[${vaLast}][va${i}]acrossfade=d=${crossfade}[vaxf${i}]`
        );

        vLast = `vxf${i}`;
        aLast = `axf${i}`;
        vaLast = `vaxf${i}`;
    });

    // ---------- MIX AUDIO ----------
    filter.push(
        `[${aLast}][${vaLast}]amix=inputs=2:weights=${volume.video} ${volume.voice}:normalize=0[mixed_a]`
    );

    cmd
        .complexFilter(filter)
        .outputOptions([
            "-map", `[${vLast}]`,
            "-map", "[mixed_a]",
            "-c:v", "h264_nvenc",
            "-preset", "p3",
            "-cq", "18",
            "-pix_fmt", "yuv420p",
            "-r", "60",
            "-c:a", "aac",
            "-b:a", "320k",
            "-shortest"
        ])
        .on("start", cmdLine => console.log("▶️ FFmpeg:\n", cmdLine))
        .on("progress", p => {
            if (p.percent != null) {
                process.stdout.write(`\rProcessing: ${p.percent.toFixed(1)}%`);
            }
        })
        .on("error", err => console.error("\n❌ FFmpeg error:", err.message))
        .on("end", () => console.log(`\n✅ Done! Saved as ${output}`))
        .save(output);
}

processVideo();
