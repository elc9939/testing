package logminer;

/**
 * The Main class serves as the entry point for the Lab 3 application.
 * Students: Use this class to verify your logic as you implement each part.
 * Running this file will demonstrate the full end-to-end concurrent pipeline.
 *
 * Do not modify this file.
 */
public final class Main {
    public static void main(String[] args) {
        int exit = new LogMinerApp().run(args);
        System.exit(exit);
    }
}
