package logminer;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/**
 * The core application logic for LogMiner.
 * Orchestrates concurrent file processing and output generation.
 *
 * This class demonstrates:
 *   - ExecutorService lifecycle management (creation, submission, shutdown).
 *   - Future-based task completion and error propagation.
 *   - Proper resource cleanup with try-with-resources.
 */
public final class LogMinerApp {
    public int run(String[] args) {
        // --- SECTION 1: CLI PARSING ---
        CliConfig config;
        try {
            config = CliConfig.parse(args);
        } catch (IllegalArgumentException e) {
            System.err.println(e.getMessage());
            System.err.println(CliConfig.usage());
            return 2;
        }

        try {
            Files.createDirectories(config.outputDir());
        } catch (IOException e) {
            System.err.println("Cannot create output directory: " + e.getMessage());
            return 2;
        }

        Path errorsCsv   = config.outputDir().resolve("errors.csv");
        Path usersCsv    = config.outputDir().resolve("users.csv");
        Path summaryJson = config.outputDir().resolve("summary.json");
        Path summaryBin  = config.outputDir().resolve("summary.bin");

        // --- SECTION 2: FILE DISCOVERY ---
        ConcurrentStatsAggregator agg = new ConcurrentStatsAggregator();
        List<Path> inputFiles;
        try {
            inputFiles = FileDiscovery.listCsvFiles(config.inputDir());
        } catch (IOException e) {
            System.err.println("Cannot list input files: " + e.getMessage());
            return 2;
        }

        if (inputFiles.isEmpty()) {
            System.err.println("No .csv files found in: " + config.inputDir());
            return 2;
        }

        // --- SECTION 3: CONCURRENT EXECUTION ---
        // TODO: Create a fixed thread pool ExecutorService with config.threads() threads.
        //       Use Executors.newFixedThreadPool().

        // TODO: Use try-with-resources to create an ErrorSink via ErrorSink.create(errorsCsv).
        // TODO: Inside the try block:
        //   1. Create a List<Future<FileTaskResult>> to hold submitted task futures.
        //   2. For each input file, submit a new LogFileTask to the pool.
        //   3. Iterate over the futures and call get() on each to wait for completion.
        //      - Catch InterruptedException: restore the interrupt flag, print a message,
        //        call pool.shutdownNow(), and return 3.
        //      - Catch ExecutionException: log the cause, call pool.shutdownNow(), and return 3.

        // TODO: In the catch block for IOException (from ErrorSink.create):
        //       Print an error message and call pool.shutdownNow(), return 2.

        // TODO: In a finally block: call pool.shutdown() to release thread pool resources.
        ExecutorService pool = Executors.newFixedThreadPool(config.threads());

        try (ErrorSink errors = ErrorSink.create(errorsCsv)) {
            List<Future<FileTaskResult>> futures = new ArrayList<>();

            for (Path file : inputFiles) {
                futures.add(pool.submit(new LogFileTask(file, agg, errors)));
            }

            for (Future<FileTaskResult> future : futures) {
                try {
                    future.get();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    System.err.println("Interrupted while waiting for tasks");
                    pool.shutdownNow();
                    return 3;
                } catch (ExecutionException e) {
                    Throwable cause = e.getCause();
                    System.err.println("Task failed: " + (cause == null ? e.getMessage() : cause.getMessage()));
                    pool.shutdownNow();
                    return 3;
                }
            }
        } catch (IOException e) {
            System.err.println("Cannot create errors.csv: " + e.getMessage());
            pool.shutdownNow();
            return 2;
        } finally {
            pool.shutdown();
        }
        // --- SECTION 4: OUTPUT GENERATION ---
        Summary summary = agg.toSummary(config);

        try {
            UsersCsvWriter.write(usersCsv, summary);
            SummaryJsonWriter.write(summaryJson, summary);
            SummaryBinaryWriter.write(summaryBin, summary);
        } catch (IOException e) {
            System.err.println("Error writing outputs: " + e.getMessage());
            return 2;
        }

        System.out.println("Wrote outputs to: " + config.outputDir());
        return 0;
    }
}
