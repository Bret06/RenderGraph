// Define the needed modules.
const fs = require("fs");
const fsp = require("fs/promises");
const ffmpeg = require("fluent-ffmpeg");
const readline = require('readline');
const path = require("path");

// Create readline interface to get input from the console
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
// Utility function to convert rl.question to a promise-based version
function askQuestion(query) {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
}

(async () => {
    // Define a path to the video directory.
    const videoDirPath = path.join(__dirname, "..");
    // Grab a list of all the folders in the video directory.
    const videoDirs = (await fsp.readdir(videoDirPath, { withFileTypes: true }))
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    // Log each directory on a new line with a number for selection.
    console.log("Available directories:");
    videoDirs.forEach((dir, index) => {
        console.log(`  [${index + 1}] ${dir}`);
    });
    // Prompt the user for the location of the video.
    const directoryPrompt = await askQuestion('Please enter the directory of the project > ');
    const directory = videoDirs[Number(directoryPrompt) - 1];
    const id = await askQuestion('Please enter the id of the project > ');

    // Define paths.
    const baseDir = path.join(videoDirPath, directory, id);
    const output = path.join(baseDir, "output.mp4");
    // Define the path to the config file.
    const configPath = path.join(baseDir, "config.json");

    // Make sure the config file exists.
    if (!fs.existsSync(configPath)) {
        console.error("❌ Missing config.json!");
        return;
    }
    // If the config file exists, read and parse it.
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { cuts, volume, fade_duration } = config;
    // Make sure the config has a cuts array.
    if (!Array.isArray(cuts) || cuts.length === 0) {
        console.error("❌ Config must include a non-empty cuts array.");
        return;
    }

    // Define the fade durations with defaults.
    const fadeIn = fade_duration.in ?? 0;
    const fadeOut = fade_duration.out ?? 0;
    const crossfade = fade_duration.crossfade ?? 0;

    // Check if the folder we are calling to has a script and if it does then run it. 
    if (fs.existsSync(path.join(__dirname, "..", directory, "script.js"))) {
        const script = require(path.join(__dirname, "..", directory, "script.js"));
        await script(config);
    }

    // Define the function that can be used to convert HH:MM:SS to seconds.
    function toSeconds(ts) {
        const p = ts.split(":").map(Number);
        if (p.length !== 3) throw new Error("Timestamp must be HH:MM:SS");
        return p[0] * 3600 + p[1] * 60 + p[2];
    }
    // Define a function that can be used to get volume for a specific file.
    function getVolume(volumes, filename) {
        return typeof volumes?.[filename] === "number"
            ? volumes[filename]
            : 1.0;
    }

    // Start building the ffmpeg command.
    const cmd = ffmpeg();

    // Create the durations array to hold each cut's duration.
    const durations = [];

    // Make sure each cut has video and voice.
    cuts.forEach((cut, i) => {
        if (!cut.video) {
            throw new Error(`❌ Cut ${i} missing "video"`);
        }
        if (!cut.voice) {
            throw new Error(`❌ Cut ${i} missing "voice"`);
        }
    });


    cuts.forEach((cut, i) => {
        const start = toSeconds(cut.start);
        const end = toSeconds(cut.end);
        const dur = end - start;

        if (dur <= 0) {
            throw new Error(`❌ Cut ${i}: end must be after start`);
        }

        const videoPath = path.join(baseDir, cut.video);
        const voicePath = path.join(baseDir, cut.voice);

        if (!fs.existsSync(videoPath)) {
            throw new Error(`❌ Cut ${i}: video not found → ${cut.video}`);
        }

        durations.push(dur);

        // 🎬 VIDEO — uses cut.start
        cmd.input(videoPath).inputOptions([
            `-ss ${start}`,
            `-t ${dur}`
        ]);

        // 🎙️ VOICE — uses SAME timestamps, but chosen timeline
        cmd.input(voicePath).inputOptions([
            `-ss ${start}`,
            `-t ${dur}`
        ]);
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

        const videoVol = getVolume(volume, cuts[i].video);
        const voiceVol = getVolume(volume, cuts[i].voice);

        filter.push(
            `[${vIn}:a]asetpts=PTS-STARTPTS,` +
            `volume=${videoVol},` +
            `afade=t=in:st=0:d=${fadeIn},` +
            `afade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}` +
            `[a${i}]`
        );

        filter.push(
            `[${aIn}:a]asetpts=PTS-STARTPTS,` +
            `volume=${voiceVol},` +
            `afade=t=in:st=0:d=${fadeIn},` +
            `afade=t=out:st=${Math.max(0, dur - fadeOut)}:d=${fadeOut}` +
            `[va${i}]`
        );



        if (i === 0) {
            vLast = `v${i}`;
            aLast = `a${i}`;
            vaLast = `va${i}`;
            return;
        }

        console.log(
            `xfade ${i}: offset=${durations.slice(0, i).reduce((a, b) => a + b, 0) - crossfade * i}`
        );


        // ---------- VIDEO CROSSFADE ----------
        filter.push(
            `[${vLast}][v${i}]xfade=transition=fade:duration=${crossfade}:offset=${durations
                .slice(0, i)
                .reduce((a, b) => a + b, 0) - crossfade * i}[vxf${i}]`
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
        `[${aLast}][${vaLast}]amix=inputs=2:normalize=0[mixed_a]`
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

        return;
})();