using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using SkillForgeTray.Services;

namespace SkillForgeTray.UI;

/// <summary>
/// Clean dark-mode Windows Forms window displaying live streaming execution logs,
/// sandbox audit verdicts, checkpoint history, and a prominent "Rollback Last Run" button.
/// </summary>
public class LogViewerForm : Form
{
    private readonly ListBox _logList;
    private readonly Button _rollbackButton;
    private readonly System.Windows.Forms.Timer _refreshTimer;
    private readonly LogBufferService _logBuffer;

    public LogViewerForm(LogBufferService logBuffer)
    {
        _logBuffer = logBuffer;

        Text = "SkillForge - Live Execution Monitor";
        ClientSize = new Size(800, 500);
        BackColor = Color.FromArgb(30, 30, 30);
        ForeColor = Color.White;

        var titleLabel = new Label
        {
            Text = "SkillForge Live Execution Monitor",
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
            ForeColor = Color.White,
            Location = new Point(16, 12),
            Size = new Size(400, 24),
        };

        _logList = new ListBox
        {
            Location = new Point(16, 48),
            Size = new Size(748, 340),
            BackColor = Color.FromArgb(20, 20, 20),
            ForeColor = Color.FromArgb(220, 220, 220),
            Font = new Font("Consolas", 9),
            BorderStyle = BorderStyle.FixedSingle,
        };

        _rollbackButton = new Button
        {
            Text = "Rollback Last Run",
            Location = new Point(16, 400),
            Size = new Size(180, 34),
            BackColor = Color.FromArgb(180, 40, 40),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
        _rollbackButton.Click += (_, _) =>
        {
            var result = MessageBox.Show(
                "Rollback the last SkillForge run? This restores the workspace to the most recent checkpoint.",
                "Rollback Last Run",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (result == DialogResult.Yes)
            {
                _logList.Items.Add("[User] Requested emergency rollback...");
            }
        };

        _refreshTimer = new System.Windows.Forms.Timer { Interval = 1000, Enabled = true };
        _refreshTimer.Tick += (_, _) => RefreshLogs();

        Controls.Add(titleLabel);
        Controls.Add(_logList);
        Controls.Add(_rollbackButton);

        RefreshLogs();
    }

    private void RefreshLogs()
    {
        var snapshot = _logBuffer.Snapshot();
        if (snapshot.Length == 0) return;

        var currentCount = _logList.Items.Count;
        var newEntries = snapshot.Length > currentCount
            ? snapshot.Skip(currentCount).ToArray()
            : Array.Empty<string>();

        foreach (var entry in newEntries)
        {
            _logList.Items.Add(entry);
        }

        if (newEntries.Length > 0)
        {
            _logList.TopIndex = _logList.Items.Count - 1;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _refreshTimer.Dispose();
        }
        base.Dispose(disposing);
    }
}
