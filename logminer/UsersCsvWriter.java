package logminer;

import java.io.*;
import java.nio.file.*;
import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * Writes the per-user summary as a CSV file.
 * Output format:
 *   userId,events,totalBytes
 *   ana,3,370
 *   sam,2,762
 *
 * Rows must be sorted by userId ascending (already guaranteed by Summary).
 */
public final class UsersCsvWriter {
    private UsersCsvWriter() {}

    public static void write(Path out, Summary summary) throws IOException {
        // TODO: Open a BufferedWriter using Files.newBufferedWriter(out, UTF_8) in try-with-resources.

        // TODO: Write the header line: "userId,events,totalBytes"
        // TODO: Call newLine().

        // TODO: For each UserSummary in summary.perUser():
        //   - Write: userId + "," + events + "," + bytes
        //   - Call newLine().
        try (BufferedWriter writer = Files.newBufferedWriter(out, UTF_8)) {

            // header
            writer.write("userId,events,totalBytes");
            writer.newLine();

            // rows
            for (Summary.UserSummary u : summary.perUser()) {
                writer.write(u.userId() + "," + u.events() + "," + u.bytes());
                writer.newLine();
            }
        }
    }
}
