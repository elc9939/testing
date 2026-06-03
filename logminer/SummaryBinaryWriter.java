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
        try (DataOutputStream data = new DataOutputStream(
                new BufferedOutputStream(Files.newOutputStream(out)))) {
            data.writeBytes("L3SB");
            data.writeByte(1);
            data.writeInt(checkedInt(s.validEvents(), "validEvents"));
            data.writeInt(checkedInt(s.invalidLines(), "invalidLines"));
            data.writeLong(s.totalBytes());
            data.writeInt(s.perUser().size());

            for (Summary.UserSummary user : s.perUser()) {
                byte[] userId = user.userId().getBytes(UTF_8);
                if (userId.length > 0xFFFF) {
                    throw new IOException("userId too long for binary summary: " + user.userId());
                }
                data.writeShort(userId.length);
                data.write(userId);
                data.writeInt(checkedInt(user.events(), "events for " + user.userId()));
                data.writeLong(user.bytes());
            }
        }
    }

    private static int checkedInt(long value, String field) throws IOException {
        if (value < Integer.MIN_VALUE || value > Integer.MAX_VALUE) {
            throw new IOException(field + " is outside binary int range: " + value);
        }
        return (int) value;
    }
}
