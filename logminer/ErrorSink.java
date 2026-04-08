package logminer;

import java.io.*;
import java.nio.file.*;
import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * A thread-safe error writer that logs invalid CSV lines to errors.csv.
 * Implements AutoCloseable so it can be used with try-with-resources.
 *
 * This class demonstrates the use of the synchronized keyword for mutual exclusion:
 * multiple threads may call record() concurrently, and synchronisation ensures
 * that individual error lines are not interleaved.
 */
public final class ErrorSink implements AutoCloseable {
    // TODO: Declare a private final BufferedWriter field.
    private final BufferedWriter writer;
    // TODO: Create a private constructor that accepts a BufferedWriter.
    private ErrorSink(BufferedWriter writer) {
        this.writer = writer;
    }
    /**
     * Factory method: creates the errors.csv file and writes the CSV header.
     */
    public static ErrorSink create(Path errorsCsv) throws IOException {
        // TODO: Open a BufferedWriter using Files.newBufferedWriter(errorsCsv, UTF_8).
        // TODO: Write the header line: "file,lineNumber,error,rawLine"
        // TODO: Call newLine() and flush().
        // TODO: Return a new ErrorSink wrapping the writer.

        BufferedWriter writer = Files.newBufferedWriter(errorsCsv, UTF_8);
        writer.write("file,lineNumber,error,rawLine");
        writer.newLine();
        writer.flush();
        return new ErrorSink(writer);

        //return null; // Placeholder
    }

    /**
     * Records a single error. This method is synchronized so that concurrent
     * writers do not interleave their output lines.
     *
     * @param file       the source CSV file path
     * @param lineNumber the 1-based line number where the error occurred
     * @param error      the error message
     * @param rawLine    the original raw CSV line
     */
    public synchronized void record(Path file, int lineNumber, String error, String rawLine) {
        // TODO: Write a CSV row with the four fields, each escaped using the escape() helper.
        // TODO: Wrap in try-catch for IOException (swallow it to keep processing going).
        try {
            writer.write(
                    escape(file.getFileName().toString()) + "," +
                            escape(Integer.toString(lineNumber)) + "," +
                            escape(error) + "," +
                            escape(rawLine)
            );
            writer.newLine();
        } catch (IOException e) {
            // swallow to keep processing going
        }
    }

    private static String escape(String s) {
        String q = s.replace("\"", "\"\"");
        return "\"" + q + "\"";
    }

    /**
     * Flushes and closes the underlying writer. Must also be synchronized
     * to avoid closing while another thread is writing.
     */
    @Override
    public synchronized void close() throws IOException {
        // TODO: Flush and close the writer.
        writer.flush();
        writer.close();
    }
}
