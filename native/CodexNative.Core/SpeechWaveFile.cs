using System.Buffers.Binary;

namespace CodexNative.Core;

public static class SpeechWaveFile
{
    private const int MaximumDataBytes = 512 * 1024 * 1024;

    public static float[] ReadMono(string path, int targetSampleRate)
    {
        if (!Path.IsPathFullyQualified(path))
            throw new ArgumentException("The speech audio path must be absolute.", nameof(path));
        if (targetSampleRate <= 0)
            throw new ArgumentOutOfRangeException(nameof(targetSampleRate));

        using var stream = File.OpenRead(path);
        using var reader = new BinaryReader(stream);
        if (ReadFourCc(reader) != "RIFF" || reader.ReadUInt32() < 4 || ReadFourCc(reader) != "WAVE")
            throw new InvalidDataException("Speech parity input must be a RIFF/WAVE file.");

        ushort format = 0;
        ushort channels = 0;
        int sourceSampleRate = 0;
        ushort blockAlign = 0;
        ushort bitsPerSample = 0;
        byte[]? audioBytes = null;
        while (stream.Position + 8 <= stream.Length)
        {
            var chunkId = ReadFourCc(reader);
            var chunkLength = reader.ReadUInt32();
            if (chunkLength > MaximumDataBytes)
                throw new InvalidDataException("Speech parity WAV data is too large.");
            var nextChunk = checked(stream.Position + chunkLength);
            if (nextChunk > stream.Length)
                throw new InvalidDataException("Speech parity WAV contains a truncated chunk.");

            if (chunkId == "fmt ")
            {
                if (chunkLength < 16)
                    throw new InvalidDataException("Speech parity WAV has an invalid format chunk.");
                format = reader.ReadUInt16();
                channels = reader.ReadUInt16();
                sourceSampleRate = reader.ReadInt32();
                _ = reader.ReadUInt32();
                blockAlign = reader.ReadUInt16();
                bitsPerSample = reader.ReadUInt16();
            }
            else if (chunkId == "data")
            {
                audioBytes = reader.ReadBytes(checked((int)chunkLength));
            }

            stream.Position = nextChunk + (chunkLength & 1);
        }

        if (audioBytes is null || channels == 0 || sourceSampleRate <= 0 || blockAlign == 0)
            throw new InvalidDataException("Speech parity WAV is missing audio format or sample data.");
        var bytesPerSample = bitsPerSample / 8;
        if (bytesPerSample == 0 || blockAlign < channels * bytesPerSample)
            throw new InvalidDataException("Speech parity WAV has an invalid sample layout.");
        if (format is not 1 and not 3 || format == 3 && bitsPerSample != 32
            || format == 1 && bitsPerSample is not 16 and not 24 and not 32)
            throw new InvalidDataException(
                $"Speech parity WAV format {format} with {bitsPerSample}-bit samples is unsupported.");

        var frameCount = audioBytes.Length / blockAlign;
        var mono = new float[frameCount];
        for (var frame = 0; frame < frameCount; frame++)
        {
            double sum = 0;
            var frameOffset = frame * blockAlign;
            for (var channel = 0; channel < channels; channel++)
            {
                var offset = frameOffset + channel * bytesPerSample;
                sum += ReadSample(audioBytes.AsSpan(offset, bytesPerSample), format, bitsPerSample);
            }
            mono[frame] = Math.Clamp((float)(sum / channels), -1, 1);
        }
        return Resample(mono, sourceSampleRate, targetSampleRate);
    }

    public static void WritePcm16Mono(string path, IReadOnlyList<float> samples, int sampleRate)
    {
        if (!Path.IsPathFullyQualified(path))
            throw new ArgumentException("The speech audio path must be absolute.", nameof(path));
        if (sampleRate <= 0)
            throw new ArgumentOutOfRangeException(nameof(sampleRate));
        if (!path.EndsWith(".wav", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Speech capture output must use a .wav extension.", nameof(path));

        var directory = Path.GetDirectoryName(path)
            ?? throw new ArgumentException("The speech audio path has no parent directory.", nameof(path));
        Directory.CreateDirectory(directory);
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read);
        using var writer = new BinaryWriter(stream);
        var dataLength = checked(samples.Count * sizeof(short));
        writer.Write("RIFF"u8);
        writer.Write(checked(36 + dataLength));
        writer.Write("WAVE"u8);
        writer.Write("fmt "u8);
        writer.Write(16);
        writer.Write((ushort)1);
        writer.Write((ushort)1);
        writer.Write(sampleRate);
        writer.Write(checked(sampleRate * sizeof(short)));
        writer.Write((ushort)sizeof(short));
        writer.Write((ushort)16);
        writer.Write("data"u8);
        writer.Write(dataLength);
        foreach (var sample in samples)
            writer.Write((short)Math.Round(Math.Clamp(sample, -1, 1) * short.MaxValue));
    }

    private static string ReadFourCc(BinaryReader reader) =>
        System.Text.Encoding.ASCII.GetString(reader.ReadBytes(4));

    private static float ReadSample(ReadOnlySpan<byte> bytes, ushort format, ushort bitsPerSample)
    {
        if (format == 3)
            return BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(bytes));
        return bitsPerSample switch
        {
            16 => BinaryPrimitives.ReadInt16LittleEndian(bytes) / 32768f,
            24 => ReadInt24(bytes) / 8388608f,
            32 => BinaryPrimitives.ReadInt32LittleEndian(bytes) / 2147483648f,
            _ => throw new InvalidDataException("Unsupported PCM sample width."),
        };
    }

    private static int ReadInt24(ReadOnlySpan<byte> bytes)
    {
        var value = bytes[0] | bytes[1] << 8 | bytes[2] << 16;
        return (value & 0x800000) == 0 ? value : value | unchecked((int)0xff000000);
    }

    private static float[] Resample(float[] samples, int sourceRate, int targetRate)
    {
        if (sourceRate == targetRate || samples.Length == 0) return samples;
        var targetLength = checked((int)Math.Round(samples.Length * (double)targetRate / sourceRate));
        if (targetLength == 0) return [];
        var result = new float[targetLength];
        var ratio = sourceRate / (double)targetRate;
        for (var index = 0; index < targetLength; index++)
        {
            var sourcePosition = index * ratio;
            var left = Math.Min((int)sourcePosition, samples.Length - 1);
            var right = Math.Min(left + 1, samples.Length - 1);
            var blend = sourcePosition - left;
            result[index] = (float)(samples[left] + (samples[right] - samples[left]) * blend);
        }
        return result;
    }
}
