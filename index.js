// Define the needed modules.
const fs = require("fs");
const fsp = require("fs/promises");
const ffmpeg = require("fluent-ffmpeg");
const readline = require("readline");
const path = require("path");

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
    // Read the config file.
    const appConfigPath = JSON.parse(await fsp.readFile("./config.json"));

    // Define the path to the video projects directory.
    const videoDirectoryPath = appConfigPath.projects_directory;

    // List available directories by filtering for directories only.
    const videoDirectories = (await fsp.readdir(videoDirectoryPath, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);
    // Prompt user to select a directory.
    console.log("Available directories:");
    videoDirectories.forEach((dir, i) => console.log(`  [${i + 1}] ${dir}`));
    const directoryPrompt = await askQuestion("Please enter the directory of the project > ");
    // Define the selected directory.
    const directory = videoDirectories[Number(directoryPrompt) - 1];

    // List available episode IDs within each directory.
    const episodeDirectories = (await fsp.readdir(path.join(videoDirectoryPath, directory), { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);
    // Prompt user to select a directory.
    console.log("Available episodes:");
    episodeDirectories.forEach((dir) => {
        // Check if the directory contains a config.json file.
        const configPath = path.join(videoDirectoryPath, directory, dir, "config.json");
        if (fs.existsSync(configPath)) {
            console.log(dir);
        }
    });
    const id = await askQuestion("Please enter the id of the episode > ");

    // Close the readline interface.
    rl.close();

    // Define the base directory for the selected project.
    const baseDirectory = path.join(videoDirectoryPath, directory, id);
    // Define the output video path.
    const output = path.join(baseDirectory, "output.mp4");
    // Define the path to the config.
    const configPath = path.join(baseDirectory, "config.json");

    // Parse the config.
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { cuts, fade_duration } = config;
    // Add directory and id to config. - This is for custom scripts.
    config.directory = directory;
    config.id = id;

    // If a custom script.js exists in the project directory, run it.
    const scriptPath = path.join(videoDirectoryPath, directory, "script.js");
    if (fs.existsSync(scriptPath)) {
        await require(scriptPath)(config);
    }
    // Validate the cuts within the array.
    if (!Array.isArray(cuts) || cuts.length === 0) {
        console.error("ERROR > Config must include a non-empty cuts array.");
        return;
    }

    // Define the fade durations with defaults.
    const fadeIn = fade_duration?.in ?? 0;
    const fadeOut = fade_duration?.out ?? 0;
    const crossfade = fade_duration?.crossfade ?? 0;

    // This function is used to convert HH:MM:SS timestamps to seconds.
    function toSeconds(ts) {
        let isNegative = false;
        if (ts.startsWith("-")) {
            isNegative = true;
            ts = ts.slice(1);
        }
        const p = ts.split(":").map(Number);
        if (p.length !== 3) throw new Error("ERROR > Timestamp must be HH:MM:SS");
        return (isNegative) ? -1 * (p[0] * 3600 + p[1] * 60 + p[2]) : p[0] * 3600 + p[1] * 60 + p[2];
    }

    // Create our ffmpeg command.
    const cmd = ffmpeg();
    // Create the durations array to hold each cut's duration.
    const durations = [];
    // Create the cutInputs array to hold each cut's input indices.
    const cutInputs = [];
    // Create input index counter.
    let inputIndex = 0;

    // Loop through each cut to set up inputs.
    cuts.forEach((cut, i) => {
        // Validate cut structure.
        if (!cut.video?.id) {
            throw new Error(`ERROR > Cut ${i} missing video.id`);
        }

        // Define the duration of the cut.
        const start = toSeconds(cut.start);
        const end = toSeconds(cut.end);
        const duration = end - start;

        // Make sure duration is valid.
        if (duration <= 0) {
            throw new Error(`ERROR > Cut ${i}: end must be after start`);
        }

        // Store duration for later.
        durations.push(duration);

        // Define the path to the video file.
        const videoPath = path.join(baseDirectory, cut.video.id);
        // If the video file doesn't exist, throw an error.
        if (!fs.existsSync(videoPath)) {
            throw new Error(`ERROR > Cut ${i}: video not found → ${cut.video.id}`);
        }

        // Define the video input index.
        const videoIndex = inputIndex++;
        // Add the video input to the ffmpeg command.
        cmd.input(videoPath).inputOptions([`-ss ${start}`, `-t ${duration}`]);

        // Define array to hold audio input indices in order.
        const audioIndices = [];

        // Add the main video audio track first.
        audioIndices.push(videoIndex);

        // Make sure the structure of cut.audio is valid.
        if (!Array.isArray(cut.audio)) {
            cut.audio = [];
        }

        // Loop through each audio track in the cut.
        cut.audio.forEach(track => {
            // Make sure the audio track exists.
            const audioPath = path.join(baseDirectory, track.id);
            if (!fs.existsSync(audioPath)) {
                throw new Error(`ERROR > Cut ${i}: audio not found → ${track.id}`);
            }

            // Define the audio offset.
            const audioOffset = (track.offset) ? toSeconds(track.offset) : 0;

            // Define the audio input index.
            audioIndices.push(inputIndex++);
            // Add the audio input to the ffmpeg command.
            cmd.input(audioPath).inputOptions([`-ss ${start}`, `-t ${duration - audioOffset}`]);
        });

        // Store the cut input indices for later.
        cutInputs.push({ videoIndex, audioIndices });
    });

    // Define the filter array to hold all filter commands.
    const filter = [];
    // Define variables to hold the most recent video and audio stream labels.
    let vLast = null;
    let aLast = null;

    // Loop through each cut to set up filters.
    cuts.forEach((cut, i) => {
        // Define the input indices for this cut.
        const { videoIndex, audioIndices } = cutInputs[i];
        // Grab the first cut's duration.
        const duration = durations[i];

        // Set up the video stream with fade in/out filters as needed.
        switch (i) {
            case 0:
                // On the first cut, only apply fade in.
                filter.push(
                    `[${videoIndex}:v]setpts=PTS-STARTPTS,` +
                    `fade=t=in:st=0:d=${fadeIn}` +
                    `[v${i}]`
                );
                break;
            case cuts.length - 1:
                // On the last cut, only apply fade out.
                filter.push(
                    `[${videoIndex}:v]setpts=PTS-STARTPTS,` +
                    `fade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}` +
                    `[v${i}]`
                );
                break;
            default:
                // On all other cuts, no fade in/out.
                filter.push(
                    `[${videoIndex}:v]setpts=PTS-STARTPTS` +
                    `[v${i}]`
                );
                break;
        }

        // Loop through each audio input for this cut and adjust it's volume and add the fade in/out filters.
        audioIndices.forEach((inputIndex, currentAudioStream) => {
            // Define the volume for this audio stream. If the audio stream's index is 0 then it is the video's audio. Otherwise, it is an external audio track.
            const volume = currentAudioStream === 0 ? cut.video.volume ?? 1.0 : cut.audio[currentAudioStream - 1]?.volume ?? 1.0;
            // Define the audio offset.
            const audioOffset = (cut.audio[currentAudioStream - 1]?.offset) ? toSeconds(cut.audio[currentAudioStream - 1].offset) : 0;
            const filterOffset = (audioOffset < 0) ? `atrim=start=${Math.abs(audioOffset)},asetpts=PTS-STARTPTS,` : (audioOffset > 0) ? `areverse,apad=pad_dur=${audioOffset}s,areverse,` : "";
            // Add the fade in/out filters to the audio stream as needed.
            switch (i) {
                case 0:
                    // On the first cut, only apply fade in.
                    filter.push(
                        `[${inputIndex}:a]asetpts=PTS-STARTPTS,` +
                        `volume=${volume},` +
                        filterOffset +
                        `afade=t=in:st=0:d=${fadeIn}` +
                        `[a${i}_${currentAudioStream}]`
                    );
                    break;
                case cuts.length - 1:
                    // On the last cut, only apply fade out.
                    filter.push(
                        `[${inputIndex}:a]asetpts=PTS-STARTPTS,` +
                        `volume=${volume},` +
                        filterOffset +
                        `afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}` +
                        `[a${i}_${currentAudioStream}]`
                    );
                    break;
                default:
                    // On all other cuts, no fade in/out.
                    filter.push(
                        `[${inputIndex}:a]asetpts=PTS-STARTPTS,` +
                        filterOffset +
                        `volume=${volume}` +
                        `[a${i}_${currentAudioStream}]`
                    );
                    break;
            }
        });

        // Mix all the audio stream labels for this cut together into a single string.
        const mixInputs = audioIndices.map((_, currentAudioStream) => `[a${i}_${currentAudioStream}]`).join("");
        // Add the amix filter to mix all audio streams together.
        filter.push(
            `${mixInputs}amix=inputs=${audioIndices.length}:normalize=0[a${i}]`
        );

        // If we are on the first cut, just set the latest video and audio labels.
        if (i === 0) {
            vLast = `v${i}`;
            aLast = `a${i}`;
            return;
        }

        // Define the offset of the current clips from the start of the video, adjusted for crossfades.
        const offset = durations.slice(0, i).reduce((a, b) => a + b, 0) - crossfade * i;

        // Add the current video cut to the previous using a crossfade.
        filter.push(
            `[${vLast}][v${i}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[vxf${i}]`
        );
        // Add the current audio cut to the previous using a crossfade.
        filter.push(
            `[${aLast}][a${i}]acrossfade=d=${crossfade}[axf${i}]`
        );

        // Update the latest video and audio labels.
        vLast = `vxf${i}`;
        aLast = `axf${i}`;
    });

    // Calculate the total duration of the final video.
    const totalDuration =
        durations.reduce((a, b) => a + b, 0) -
        crossfade * (durations.length - 1);

    // Function to convert timemark (HH:MM:SS.xx) to seconds.
    function timemarkToSeconds(t) {
        const [h, m, s] = t.split(":");
        return (+h) * 3600 + (+m) * 60 + parseFloat(s);
    }
    // Set up the final output options and start processing.
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
        .on("start", cmdLine => console.log("Exporting Video > \n", cmdLine))
        .on("progress", p => {
            if (!p.timemark) return;

            const current = timemarkToSeconds(p.timemark);
            const percent = Math.min(100, (current / totalDuration) * 100);

            process.stdout.write(
                `\rExporting > ${percent.toFixed(1)}% (${current.toFixed(1)}s / ${totalDuration.toFixed(1)}s)`
            );
        })
        .on("error", err => console.error("\nError >", err.message))
        .on("end", () => console.log(`\nRender Complete > Saved as ${output}`))
        .save(output);
})();
