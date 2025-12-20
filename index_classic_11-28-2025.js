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
    const { directory, id, start, end, volume, fadeDuration } = config;

    const inputVideo = path.join(__dirname, "..", directory, id, "video.mp4");
    const inputAudio = path.join(__dirname, "..", directory, id, "voice.wav");
    const output = path.join(__dirname, "..", directory, id, "output.mp4");

    // Place a copy of the config in the output folder for reference.
    console.log("📄 Saving config to output folder...");
    await fsp.writeFile(path.join(__dirname, "..", directory, id, "config.json"), JSON.stringify(config, null, 2), "utf8");

    // Check if the folder we are calling to has a script and if it does then run it.
    if (fs.existsSync(path.join(__dirname, "..", directory, "script.js"))) {
        const script = require(path.join(__dirname, "..", directory, "script.js"));
        await script(config);
    }

    if (!inputVideo || !inputAudio || !output) {
        console.error("❌ Config must include inputVideo, inputAudio, and output paths.");
        return;
    }

    function toSeconds(ts) {
        const p = ts.split(":").map(Number);
        if (p.length !== 3) throw new Error("Timestamp must be HH:MM:SS");
        return p[0] * 3600 + p[1] * 60 + p[2];
    }

    const startSec = toSeconds(start);
    const endSec = toSeconds(end);
    const duration = endSec - startSec;

    if (duration <= 0) {
        console.error("❌ End time must be after start time.");
        return;
    }

    console.log(`🎬 Video: ${inputVideo}`);
    console.log(`🎧 Voice: ${inputAudio}`);
    console.log(`⏱ ${start} → ${end} | Fade: ${fadeDuration}s`);
    console.log(`💾 Output: ${output}`);

    // Combined filter
    const filterComplex = [
        `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${duration - fadeDuration}:d=${fadeDuration},scale=2560:1440[v]`,
        `[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS,volume=${volume.video}dB[orig_a]`,
        `[1:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS,volume=${volume.voice}dB[voice_a]`,
        `[orig_a][voice_a]amix=inputs=2:duration=shortest:weights=1 1[mixed_a]`
    ];


    ffmpeg()
        .input(inputVideo)
        .input(inputAudio)
        .complexFilter(filterComplex)
        .outputOptions([
            "-map [v]",
            "-map [mixed_a]",
            "-c:v h264_nvenc",
            "-preset p3",
            "-cq 18",
            "-pix_fmt yuv420p",
            "-r 60",
            "-c:a aac",
            "-b:a 320k",
            "-shortest"
        ])
        .on("start", cmd => console.log("▶️ Running FFmpeg:\n", cmd))
        .on("progress", p => process.stdout.write(`\rProcessing: ${p.percent?.toFixed(1)}%`))
        .on("error", err => console.error("\n❌ FFmpeg error:", err.message))
        .on("end", () => console.log(`\n✅ Done! Saved as ${output}`))
        .save(output);
}

processVideo();
