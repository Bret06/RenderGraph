// Define the needed modules.
const fs = require("fs");
const fsp = require("fs/promises");
const ffmpeg = require("fluent-ffmpeg");
const readline = require("readline");
const path = require("path");

// Read the config.
const appConfigPath = require("./config.json");

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Utility function to convert rl.question to a promise-based version
function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

(async () => {
    const videoDirPath = appConfigPath.projects_directory;

    const videoDirs = (await fsp.readdir(videoDirPath, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);

    console.log("Available directories:");
    videoDirs.forEach((dir, i) => console.log(`  [${i + 1}] ${dir}`));

    const directoryPrompt = await askQuestion("Please enter the directory of the project > ");
    const directory = videoDirs[Number(directoryPrompt) - 1];
    const id = await askQuestion("Please enter the id of the episode > ");

    rl.close();

    const baseDir = path.join(videoDirPath, directory, id);
    const output = path.join(baseDir, "output.mp4");
    const configPath = path.join(baseDir, "config.json");

    if (!fs.existsSync(configPath)) {
        console.error("❌ Missing config.json!");
        return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { cuts, fade_duration } = config;
    config.directory = directory;
    config.id = id;

    const scriptPath = path.join(videoDirPath, directory, "script.js");
    if (fs.existsSync(scriptPath)) {
        await require(scriptPath)(config);
    }

    if (!Array.isArray(cuts) || cuts.length === 0) {
        console.error("❌ Config must include a non-empty cuts array.");
        return;
    }

    const fadeIn = fade_duration?.in ?? 0;
    const fadeOut = fade_duration?.out ?? 0;
    const crossfade = fade_duration?.crossfade ?? 0;

    function toSeconds(ts) {
        const p = ts.split(":").map(Number);
        if (p.length !== 3) throw new Error("Timestamp must be HH:MM:SS");
        return p[0] * 3600 + p[1] * 60 + p[2];
    }

    const cmd = ffmpeg();
    const durations = [];
    const cutInputs = [];
    let inputIndex = 0;

    // ---------------- INPUTS ----------------
    cuts.forEach((cut, i) => {
        if (!cut.video?.id) {
            throw new Error(`❌ Cut ${i} missing video.id`);
        }

        const start = toSeconds(cut.start);
        const end = toSeconds(cut.end);
        const dur = end - start;

        if (dur <= 0) {
            throw new Error(`❌ Cut ${i}: end must be after start`);
        }

        durations.push(dur);

        // 🎬 VIDEO
        const videoPath = path.join(baseDir, cut.video.id);
        if (!fs.existsSync(videoPath)) {
            throw new Error(`❌ Cut ${i}: video not found → ${cut.video.id}`);
        }

        const videoIndex = inputIndex++;
        cmd.input(videoPath).inputOptions([`-ss ${start}`, `-t ${dur}`]);

        // 🎙️ AUDIO — ALWAYS include video audio
        const audioIndices = [];

        // 1️⃣ Video’s embedded audio (base layer)
        audioIndices.push(videoIndex);

        // Normalize structure
        if (!Array.isArray(cut.audio)) {
            cut.audio = [];
        }

        // 2️⃣ Extra audio tracks (voice, music, etc.)
        cut.audio.forEach(track => {
            const audioPath = path.join(baseDir, track.id);
            if (!fs.existsSync(audioPath)) {
                throw new Error(`❌ Cut ${i}: audio not found → ${track.id}`);
            }

            audioIndices.push(inputIndex++);
            cmd.input(audioPath).inputOptions([`-ss ${start}`, `-t ${dur}`]);
        });


        cutInputs.push({ videoIndex, audioIndices });
    });

    // ---------------- FILTER GRAPH ----------------
    const filter = [];
    let vLast = null;
    let aLast = null;

    cuts.forEach((cut, i) => {
        const { videoIndex, audioIndices } = cutInputs[i];
        const dur = durations[i];

        // 🎬 VIDEO
        filter.push(
            `[${videoIndex}:v]setpts=PTS-STARTPTS,` +
            `fade=t=in:st=0:d=${fadeIn},` +
            `fade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}` +
            `[v${i}]`
        );

        // 🎙️ AUDIO
        audioIndices.forEach((aIdx, j) => {
            const vol =
                j === 0
                    ? cut.video.volume ?? 1.0
                    : cut.audio[j - 1]?.volume ?? 1.0;

            filter.push(
                `[${aIdx}:a]asetpts=PTS-STARTPTS,` +
                `volume=${vol},` +
                `afade=t=in:st=0:d=${fadeIn},` +
                `afade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}` +
                `[a${i}_${j}]`
            );
        });

        const mixInputs = audioIndices.map((_, j) => `[a${i}_${j}]`).join("");
        filter.push(
            `${mixInputs}amix=inputs=${audioIndices.length}:normalize=0[a${i}]`
        );

        if (i === 0) {
            vLast = `v${i}`;
            aLast = `a${i}`;
            return;
        }

        const offset =
            durations.slice(0, i).reduce((a, b) => a + b, 0) - crossfade * i;

        filter.push(
            `[${vLast}][v${i}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[vxf${i}]`
        );
        filter.push(
            `[${aLast}][a${i}]acrossfade=d=${crossfade}[axf${i}]`
        );

        vLast = `vxf${i}`;
        aLast = `axf${i}`;
    });

    // ---------------- OUTPUT ----------------

    const totalDuration =
        durations.reduce((a, b) => a + b, 0) -
        crossfade * (durations.length - 1);

    function timemarkToSeconds(t) {
        const [h, m, s] = t.split(":");
        return (+h) * 3600 + (+m) * 60 + parseFloat(s);
    }
    cmd
        .complexFilter(filter)
        .outputOptions([
            "-map", `[${vLast}]`,
            "-map", `[${aLast}]`,
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
            if (!p.timemark) return;

            const current = timemarkToSeconds(p.timemark);
            const percent = Math.min(100, (current / totalDuration) * 100);

            process.stdout.write(
                `\rProcessing: ${percent.toFixed(1)}% (${current.toFixed(1)}s / ${totalDuration.toFixed(1)}s)`
            );
        })
        .on("error", err => console.error("\n❌ FFmpeg error:", err.message))
        .on("end", () => console.log(`\n✅ Done! Saved as ${output}`))
        .save(output);
})();
