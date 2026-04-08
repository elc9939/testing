package logminer;

import java.io.*;
import java.nio.file.*;
import java.util.Map;

import static java.nio.charset.StandardCharsets.UTF_8;

/**
 * Writes the summary report as a valid JSON file (RFC 8259).
 *
 * The output must match this structure exactly:
 * {
 *   "meta": { "generatedBy": "LogMiner", "inputDir": "...", "threads": N },
 *   "totals": { "validEvents": N, "invalidLines": N, "totalBytes": N },
 *   "counts": {
 *     "byAction": { "DOWNLOAD": N, "LOGIN": N, "LOGOUT": N, "UPLOAD": N },
 *     "byStatus": { "200": N, ... }
 *   },
 *   "perUser": [ { "userId": "...", "events": N, "bytes": N }, ... ],
 *   "topUsersByBytes": [ { "userId": "...", "bytes": N }, ... ]
 * }
 */
public final class SummaryJsonWriter {
    private SummaryJsonWriter() {}

    public static void write(Path out, Summary s) throws IOException {
        // TODO: Open a BufferedWriter using Files.newBufferedWriter(out, UTF_8) in try-with-resources.

        // TODO: Write the JSON structure manually (no external library required).
        //       Use the jsonString() and objLongMap() helper methods below.

        // TODO: Write "meta" object with generatedBy, inputDir, threads.
        // TODO: Write "totals" object with validEvents, invalidLines, totalBytes.
        // TODO: Write "counts" object containing byAction and byStatus sub-objects.
        // TODO: Write "perUser" array with userId, events, bytes for each user.
        // TODO: Write "topUsersByBytes" array with userId, bytes for each top user.
        try (BufferedWriter w = Files.newBufferedWriter(out, UTF_8)) {
            w.write("{\n");

            w.write("  \"meta\": {\n");
            w.write("    \"generatedBy\": \"LogMiner\",\n");
            w.write("    \"inputDir\": " + jsonString(s.inputDir()) + ",\n");
            w.write("    \"threads\": " + s.threads() + "\n");
            w.write("  },\n");

            w.write("  \"totals\": {\n");
            w.write("    \"validEvents\": " + s.validEvents() + ",\n");
            w.write("    \"invalidLines\": " + s.invalidLines() + ",\n");
            w.write("    \"totalBytes\": " + s.totalBytes() + "\n");
            w.write("  },\n");

            w.write("  \"counts\": {\n");
            w.write("    \"byAction\": " + objLongMap(s.byAction(), 4) + ",\n");
            w.write("    \"byStatus\": " + objLongMap(s.byStatus(), 4) + "\n");
            w.write("  },\n");

            w.write("  \"perUser\": [\n");
            for (int i = 0; i < s.perUser().size(); i++) {
                Summary.UserSummary u = s.perUser().get(i);
                w.write("    { \"userId\": " + jsonString(u.userId())
                        + ", \"events\": " + u.events()
                        + ", \"bytes\": " + u.bytes() + " }");
                w.write(i + 1 == s.perUser().size() ? "\n" : ",\n");
            }
            w.write("  ],\n");

            w.write("  \"topUsersByBytes\": [\n");
            for (int i = 0; i < s.topUsersByBytes().size(); i++) {
                Summary.UserBytes u = s.topUsersByBytes().get(i);
                w.write("    { \"userId\": " + jsonString(u.userId())
                        + ", \"bytes\": " + u.bytes() + " }");
                w.write(i + 1 == s.topUsersByBytes().size() ? "\n" : ",\n");
            }
            w.write("  ]\n");

            w.write("}\n");
        }
        // Hint: Use commas between array/object elements, but NOT after the last element.
    }

    /**
     * Escapes a string for safe JSON embedding.
     */
    private static String jsonString(String s) {
        String esc = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n");
        return "\"" + esc + "\"";
    }

    /**
     * Formats a Map<String, Long> as a JSON object string.
     */
    private static String objLongMap(Map<String, Long> m, int indent) {
        String pad = " ".repeat(indent);
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        int i = 0;
        for (var e : m.entrySet()) {
            sb.append(pad).append("  ").append(jsonString(e.getKey()))
              .append(": ").append(e.getValue());
            sb.append(i + 1 == m.size() ? "\n" : ",\n");
            i++;
        }
        sb.append(pad).append("}");
        return sb.toString();
    }
}
