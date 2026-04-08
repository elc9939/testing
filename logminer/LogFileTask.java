package logminer;

import java.io.*;
import java.nio.file.*;
import static java.nio.charset.StandardCharsets.UTF_8;

import java.util.concurrent.Callable;

/**
 * A Callable task that processes a single CSV log file.
 * One instance is submitted per file to the ExecutorService.
 *
 * Responsibilities:
 *   - Open the file with a BufferedReader (try-with-resources).
 *   - Validate the header line.
 *   - Parse each data line using CsvLogParser.
 *   - On success: update the shared ConcurrentStatsAggregator.
 *   - On failure: increment the invalid counter and record the error in ErrorSink.
 */
public final class LogFileTask implements Callable<FileTaskResult> {

    // TODO: Declare private final fields for:
    //   - Path file
    //   - ConcurrentStatsAggregator agg
    //   - ErrorSink errors
    private final Path file;
    private final ConcurrentStatsAggregator agg;
    private final ErrorSink errors;

    // TODO: Create a constructor that accepts and assigns all three fields.
    public LogFileTask(Path file, ConcurrentStatsAggregator agg, ErrorSink errors) {
        this.file = file;
        this.agg = agg;
        this.errors = errors;
    }

    @Override
    public FileTaskResult call() throws Exception {
        int linesRead = 0;
        int invalid = 0;

        // TODO: Open a BufferedReader for the file using Files.newBufferedReader(file, UTF_8)
        //       inside a try-with-resources block.

        // TODO: Read the first line as the header. Increment linesRead.
        // TODO: If the header is null or doesn't match CsvLogParser.REQUIRED_HEADER (after trimming),
        //       throw an IOException: "Bad header in " + file.getFileName().

        // TODO: Read remaining lines in a while loop:
        //   - Increment linesRead for each line.
        //   - Try to parse the line with CsvLogParser.parseLine().
        //   - On success: call agg.recordValid(record).
        //   - On LogParseException: increment invalid, call agg.recordInvalid(),
        //     and call errors.record() with the file, line number, error message, and raw line.

        try (BufferedReader reader = Files.newBufferedReader(file, UTF_8)) {
            String header = reader.readLine();
            linesRead++;
            if (header == null || !header.trim().equals(CsvLogParser.REQUIRED_HEADER)) {
                throw new IOException("Bad header in " + file.getFileName());
            }
            String line;
            while ((line = reader.readLine()) != null) {
                linesRead++;
                try {
                    LogRecord record = CsvLogParser.parseLine(line);
                    agg.recordValid(record);
                } catch (LogParseException e) {
                    invalid++;
                    agg.recordInvalid();
                    errors.record(file, linesRead, e.getMessage(), line);
                }
            }
        }
        return new FileTaskResult(file.getFileName().toString(), linesRead, invalid);
    }
}
