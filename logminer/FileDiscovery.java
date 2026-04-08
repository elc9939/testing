package logminer;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Discovers all .csv files in a given directory.
 */
public final class FileDiscovery {
    private FileDiscovery() {}

    /**
     * Lists all .csv files in the given directory (non-recursive), sorted by name.
     *
     * @param inputDir the directory to scan
     * @return a sorted list of Paths to .csv files
     * @throws IOException if the directory cannot be read
     */
    public static List<Path> listCsvFiles(Path inputDir) throws IOException {
        // TODO: Verify inputDir is a directory using Files.isDirectory(). If not, throw IOException.

        // TODO: Use Files.list(inputDir) inside a try-with-resources block.
        // TODO: Filter to only files ending in ".csv".
        // TODO: Sort the results.
        // TODO: Collect to a List and return.
        if (!Files.isDirectory(inputDir)) {
            throw new IOException("not a directory: " + inputDir);
        }

        try (Stream<Path> stream = Files.list(inputDir)) {
            return stream
                    .filter(p -> p.toString().endsWith(".csv"))
                    .sorted()
                    .collect(Collectors.toList());
        }

        //return List.of(); // Placeholder
    }
}
