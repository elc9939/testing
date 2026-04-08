package logminer;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Parses and holds command-line arguments for the LogMiner application.
 * Do not modify this file.
 */
public record CliConfig(Path inputDir, Path outputDir, int threads, int topUsers) {

    public static CliConfig parse(String[] args) {
        Path input = null;
        Path output = null;
        int threads = Math.min(4, Runtime.getRuntime().availableProcessors());
        int top = 5;

        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            switch (a) {
                case "--input" -> input = Paths.get(requireArg(args, ++i, "--input requires a value"));
                case "--output" -> output = Paths.get(requireArg(args, ++i, "--output requires a value"));
                case "--threads" -> threads = Integer.parseInt(requireArg(args, ++i, "--threads requires a value"));
                case "--topUsers" -> top = Integer.parseInt(requireArg(args, ++i, "--topUsers requires a value"));
                default -> throw new IllegalArgumentException("Unknown argument: " + a);
            }
        }

        if (input == null || output == null) {
            throw new IllegalArgumentException("Missing required arguments --input and/or --output");
        }
        if (threads <= 0) throw new IllegalArgumentException("--threads must be > 0");
        if (top <= 0) throw new IllegalArgumentException("--topUsers must be > 0");

        return new CliConfig(input, output, threads, top);
    }

    private static String requireArg(String[] args, int idx, String msg) {
        if (idx >= args.length) throw new IllegalArgumentException(msg);
        return args[idx];
    }

    public static String usage() {
        return """
            Usage:
              java logminer.Main --input <dir> --output <dir> [--threads N] [--topUsers K]
            """;
    }
}
