using System.Collections.Concurrent;

namespace SkillForgeTray.Services;

/// <summary>
/// Thread-safe circular buffer storing the last 500 execution &amp; sandbox audit events.
/// </summary>
public class LogBufferService
{
    private readonly ConcurrentQueue<string> _buffer = new();
    private readonly int _capacity;

    public LogBufferService(int capacity = 500)
    {
        _capacity = capacity;
    }

    public void Add(string entry)
    {
        _buffer.Enqueue(entry);
        while (_buffer.Count > _capacity)
        {
            _buffer.TryDequeue(out _);
        }
    }

    public string[] Snapshot()
    {
        return _buffer.ToArray();
    }

    public int Count => _buffer.Count;
}
