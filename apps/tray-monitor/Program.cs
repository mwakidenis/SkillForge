using SkillForgeTray.Services;
using SkillForgeTray.UI;

namespace SkillForgeTray;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var ipcClient = new IpcClientService();
        var logBuffer = new LogBufferService(capacity: 500);

        using var context = new TrayApplicationContext(ipcClient, logBuffer);
        Application.Run(context);
    }
}
