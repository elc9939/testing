package logminer;

import java.io.*;
import java.nio.file.*;
import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * Writes a portable binary snapshot of the summary using DataOutputStream.
 *
 * Binary format v1:
 *   4 bytes:  ASCII magic "L3SB"
 *   1 byte:   version = 1
 *   4 bytes:  int validEvents
 *   4 bytes:  int invalidLines
 *   8 bytes:  long totalBytes
 *   4 bytes:  int number of user records U
 *   For each user record:
 *     2 bytes:  unsigned short — UTF-8 byte length of userId
 *     n bytes:  UTF-8 bytes of userId
 *     4 bytes:  int events
 *     8 bytes:  long bytes
 *
 * This file can be read back using DataInputStream for validation and testing.
 */
public final class SummaryBinaryWriter {
    private SummaryBinaryWriter() {}

    public static void write(Path out, Summary s) throws IOException {
        // TODO: Open a DataOutputStream wrapping a BufferedOutputStream wrapping Files.newOutputStream(out).
        //       Use try-with-resources.

        // TODO: Write the 4-byte ASCII magic "L3SB" using writeBytes().
        // TODO: Write version byte (1) using writeByte().

        // TODO: Write validEvents as int using writeInt().
        // TODO: Write invalidLines as int using writeInt().
        // TODO: Write totalBytes as long using writeLong().

        // TODO: Write the number of user records using writeInt().
        // TODO: For each UserSummary in summary.perUser():
        //   1. Convert userId to UTF-8 bytes.
        //   2. Write the byte length as an unsigned short using writeShort().
        //   3. Write the userId bytes using write(byte[]).
        //   4. Write events as int using writeInt().
        //   5. Write bytes as long using writeLong().
    }
}
