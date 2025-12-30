# Command Reference:
- ``ss`` - Seek Start, finds the start timestamp of the video.
- ``t`` - Duration, tells the system to only read that amount of time.
- ``[${videoIndex}:v]`` - Selects a input stream by index, so the first video would be 0 and so on.
- ``setpts`` - Set Presentation Timestamp, tells FFmpeg when each frame should be displayed. If you trim a video using ``-ss`` or ``-t`` the timestamps do not reset automatically. So by setting this value to ``setpts=PTS-STARTPTS`` we are effectively resetting the keyframe we're on.
- ``fade=t=in:st=0:d=${fadeIn}`` - this is used to make a clip fade in. ``t=in`` > fade in. ``st=0`` > tells the transition to start at 0 seconds. ``d=${fadeIn}`` > duration of the fade in seconds. If you don't reset setpts to start then ``st=0`` won't line up correctly. (In these fade commands "t" stands for transition.)
- ``fade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`` - this is used to make the clip fade out and has the same exact layout as fade in it just does some extra math to figure out where to start the fade out.
- ``[v${i}]`` - this is a label for the output of a filter chain. Can be used to reference this chain of filters later.
- ``${mixInputs}amix=inputs=${audioIndices.length}:normalize=0[a${i}]`` - used to mix multiple audio inputs together. ``amix`` says to combine tracks. ``inputs=${audioIndices.length}`` tells FFMPEG how many streams are being provided. ``normalize=0`` means don't automatically normalize the audio. ``[a${i}]`` Labels the mixed output of the cut.
- ``xfade`` - crossfade filter.
- ``-map`` - Defines what will be added to the final output file.
- ``-c:v`` - Tells FFMPEG what encoder to use for video.
- ``-c:a`` - Tells FFMPEG what encoder to use for audio.
- ``-preset`` - Tells FFMPEG what quality you want for the video.
    - p1 - Fastest Speed, Lowest Quality
    - p3 - Fast Speed, Good Quality
    - p5 - Balanced Speed, Better Quality
    - p7 - Slowest Speed, Best Quality
- ``-cq`` - Constant Quality, lower number = higher quality. Good range: 16 > visually loseless, 18 > high quality, 23 > YouTube Compression sort of thing.
- ``-pix_fmt`` - Pixel Format, changes the pixel format sticking to ``yuv420p`` because I don't want to break it.
- ``-r`` - Output Framerate, just forces a constant framerate regardless of the video framerate. :)
- ``-b:a`` - Audio bitrate. Yep, that's it.
- ``-shortest`` - Stops encoding when the shortest stream ends. Pretty much just says: "End the output when either audio or video runs out."
- ``areverse`` - Reverses audio.
- ``apad=pad_dur`` - Adds silence to the end of an audio clip.
- ``atrim=start=${Math.abs(audioOffset)}`` - Throws away the first "Math.abs(audioOffset)" of the audio.

# Build Events:
- Create the FFMPEG command.
- Loop through each cut. - Assembly:
    - Store the duration of the cut in the "durations" array.
    - Add the video to the command.
    - Add the video's audio track to the "audioIndices" array and account for audio offset that will be applied later.
    - Loop through each audio track in the cut and add it to the command.
    - Store the cut input indices for later.
- Loop through each cut. - Filters:
    - Add the fade in/out filters to the cut.
    - Loop through each audio input for this cut and adjust it's volume, offset, and add the fade in/out filters.
    - Combine all the audio tracks into one.
    - In order of index combine each clip together with a crossfade.
- Compile the video.

# TO-DO:
- Add a config generation system to allow the script to create a config.json for a video. It will do so by checking for video.mp4 and setting the times accordingly. Ideally, it will also look for mp3s and wavs and auto add them as well. / Ask for the times you want for each clip.