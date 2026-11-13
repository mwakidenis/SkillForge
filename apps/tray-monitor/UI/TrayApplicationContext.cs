using System.Drawing;
using System.Windows.Forms;
using SkillForgeTray.Models;
using SkillForgeTray.Services;

namespace SkillForgeTray.UI;

/// <summary>
/// Runs cleanly in the Windows notification tray without a lingering taskbar window.
/// Generates crisp 16x16 status icons via System.Drawing.Graphics so zero external .ico assets are required.
/// </summary>
public class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon _trayIcon;
    private readonly ContextMenuStrip _menu;
    private readonly IpcClientService _ipcClient;
    private readonly LogBufferService _logBuffer;
    private readonly System.Windows.Forms.Timer _pollTimer;
    private ToolStripItem _statusLabel = null!;
    private ToolStripItem _monitorItem = null!;
    private ToolStripItem _rollbackItem = null!;

    public TrayApplicationContext(IpcClientService ipcClient, LogBufferService logBuffer)
    {
        _ipcClient = ipcClient;
        _logBuffer = logBuffer;

        _trayIcon = new NotifyIcon
        {
            Visible = true,
            Text = "SkillForge - Offline",
            Icon = CreateIcon(StatusColor.Gray, "OFF"),
        };

        _menu = new ContextMenuStrip();

        _statusLabel = new ToolStripLabel("Status: Offline") { Enabled = false };
        _menu.Items.Add(_statusLabel);
        _menu.Items.Add(new ToolStripSeparator());

        var monitorItem = new ToolStripMenuItem("Open Live Execution Monitor...");
        monitorItem.Click += (_, _) => OpenLogViewer();
        _monitorItem = monitorItem;
        _menu.Items.Add(_monitorItem);

        var rollbackItem = new ToolStripMenuItem("Trigger Emergency Git Rollback");
        rollbackItem.Click += async (_, _) => await TriggerEmergencyRollback();
        _rollbackItem = rollbackItem;
        _menu.Items.Add(_rollbackItem);

        _menu.Items.Add(new ToolStripSeparator());
        var exitItem = new ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => Application.Exit();
        _menu.Items.Add(exitItem);

        _trayIcon.ContextMenuStrip = _menu;

        _ipcClient.StatusChanged += OnStatusChanged;
        _ipcClient.OfflineChanged += OnOfflineChanged;
        _pollTimer = new System.Windows.Forms.Timer { Interval = 1000, Enabled = true };
        _pollTimer.Tick += async (_, _) => await PollStatus();
    }

    private async Task PollStatus()
    {
        try
        {
            var status = await _ipcClient.FetchStatusAsync();
            if (status != null)
            {
                UpdateStatus(status);
            }
        }
        catch
        {
            // polling failures are handled by IpcClientService offline logic
        }
    }

    private Task OnStatusChanged(DaemonStatusDto dto)
    {
        UpdateStatus(dto);
        return Task.CompletedTask;
    }

    private Task OnOfflineChanged(bool online)
    {
        if (online)
        {
            SetIcon(StatusColor.Gray, "OFF");
            _statusLabel!.Text = "Status: Offline";
        }
        else
        {
            SetIcon(StatusColor.Gray, "OFF");
            _statusLabel!.Text = "Status: Offline";
        }
        return Task.CompletedTask;
    }

    private void UpdateStatus(DaemonStatusDto dto)
    {
        var label = $"Status: {dto.Status}";
        if (dto.ActiveSkillId != null)
        {
            label += $" | {dto.ActiveSkillId}";
        }

        _statusLabel!.Text = label;
        _statusLabel.Enabled = true;

        var color = dto.Status switch
        {
            "IDLE" => StatusColor.Green,
            "RUNNING" => StatusColor.Amber,
            "ERROR" => StatusColor.Red,
            _ => StatusColor.Gray,
        };

        var shortCode = dto.Status switch
        {
            "IDLE" => "IDLE",
            "RUNNING" => "RUN",
            "ERROR" => "ERR",
            _ => "OFF",
        };

        SetIcon(color, shortCode);

        if (_logBuffer.Count < 50)
        {
            _logBuffer.Add($"[{dto.Timestamp ?? DateTime.UtcNow.ToString("hh:mm:ss")}] {dto.Status} | {dto.ActiveSkillId ?? "-"}");
        }
    }

    private async Task TriggerEmergencyRollback()
    {
        var result = MessageBox.Show(
            "Trigger emergency Git rollback of the most recent checkpoint?\n\nThis restores the workspace to the last SkillForge checkpoint.",
            "SkillForge Emergency Rollback",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);

        if (result != DialogResult.Yes) return;

        var ok = await _ipcClient.TriggerEmergencyRollbackAsync();
        var msg = ok
            ? "Emergency rollback triggered successfully."
            : "Failed to contact the SkillForge daemon. Is it running?";
        MessageBox.Show(msg, "SkillForge Rollback", MessageBoxButtons.OK, ok ? MessageBoxIcon.Information : MessageBoxIcon.Error);

        _logBuffer.Add($"[Rollback] ok={ok}");
    }

    private void OpenLogViewer()
    {
        var form = new LogViewerForm(_logBuffer);
        form.Show();
    }

    private void SetIcon(StatusColor color, string text)
    {
        var newIcon = CreateIcon(color, text);
        var oldIcon = _trayIcon.Icon;
        _trayIcon.Icon = newIcon;
        _trayIcon.Text = $"SkillForge - {text}";
        if (oldIcon != null)
        {
            oldIcon.Dispose();
        }
    }

    private static Icon CreateIcon(StatusColor color, string text)
    {
        var bitmap = new Bitmap(16, 16);
        using var g = Graphics.FromImage(bitmap);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;

        var bg = color switch
        {
            StatusColor.Gray => Color.FromArgb(120, 120, 120),
            StatusColor.Green => Color.FromArgb(60, 180, 75),
            StatusColor.Amber => Color.FromArgb(240, 180, 0),
            StatusColor.Red => Color.FromArgb(220, 50, 50),
            _ => Color.FromArgb(120, 120, 120),
        };

        g.FillEllipse(new SolidBrush(bg), 1, 1, 14, 14);
        g.DrawEllipse(Pens.Black, 1, 1, 14, 14);

        using var font = new Font("Segoe UI", 7, FontStyle.Bold);
        var size = g.MeasureString(text, font);
        g.DrawString(text, font, Brushes.White, (16 - size.Width) / 2f, (16 - size.Height) / 2f);

        return Icon.FromHandle(bitmap.GetHicon());
    }

    private enum StatusColor
    {
        Gray,
        Green,
        Amber,
        Red,
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _pollTimer.Dispose();
            _ipcClient.Dispose();
            _trayIcon.Dispose();
            _menu.Dispose();
        }
        base.Dispose(disposing);
    }
}
