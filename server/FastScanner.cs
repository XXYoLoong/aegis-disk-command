using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Web.Script.Serialization;

namespace DiskCommand
{
    public static class FastScanner
    {
        public static void Run(string driveLetter, int rootLimit, int focusLimit, int childLimit, int fileLimit)
        {
            Console.OutputEncoding = Encoding.UTF8;
            var scanner = new Scanner(driveLetter, rootLimit, focusLimit, childLimit, fileLimit);
            scanner.Execute();
        }
    }

    internal sealed class Scanner
    {
        private const long ProgressIntervalMs = 250;
        private const int TopFilesPerFocus = 3;

        private readonly string _driveLetter;
        private readonly string _rootPath;
        private readonly int _rootLimit;
        private readonly int _focusLimit;
        private readonly int _childLimit;
        private readonly int _fileLimit;
        private readonly JavaScriptSerializer _serializer;
        private readonly Stopwatch _stopwatch;
        private readonly List<RootAccumulator> _roots;

        private long _filesVisited;
        private long _directoriesVisited;
        private long _bytesSeen;
        private int _rootsTotal;
        private int _rootsCompleted;
        private long _lastProgressAtMs;
        private string _currentRoot;
        private string _currentPath;

        public Scanner(string driveLetter, int rootLimit, int focusLimit, int childLimit, int fileLimit)
        {
            _driveLetter = driveLetter.ToUpperInvariant();
            _rootPath = _driveLetter + @":\";
            _rootLimit = rootLimit;
            _focusLimit = focusLimit;
            _childLimit = childLimit;
            _fileLimit = fileLimit;
            _serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            _stopwatch = Stopwatch.StartNew();
            _roots = new List<RootAccumulator>();
        }

        public void Execute()
        {
            EmitProgress("preparing", true);

            var rootEntries = new List<FindItem>();
            foreach (var item in NativeEnumerator.Enumerate(_rootPath))
            {
                rootEntries.Add(item);
            }

            _rootsTotal = rootEntries.Count;
            EmitProgress("preparing", true);

            foreach (var item in rootEntries)
            {
                var fullPath = CombinePath(_rootPath, item.Name);
                _currentRoot = fullPath;
                _currentPath = fullPath;

                if (item.IsDirectory)
                {
                    _directoriesVisited++;

                    if (item.IsReparsePoint)
                    {
                        _roots.Add(new RootAccumulator(item.Name, fullPath, true));
                    }
                    else
                    {
                        var bucket = new RootAccumulator(item.Name, fullPath, true);
                        ScanDirectoryTree(bucket);
                        _roots.Add(bucket);
                    }
                }
                else
                {
                    _filesVisited++;
                    _bytesSeen += item.SizeBytes;
                    var bucket = new RootAccumulator(item.Name, fullPath, false);
                    bucket.SizeBytes = item.SizeBytes;
                    bucket.AddTopFile(new FileEntry(item.Name, fullPath, item.SizeBytes));
                    _roots.Add(bucket);
                }

                _rootsCompleted++;
                EmitProgress("scanning", true);
            }

            _currentRoot = null;
            _currentPath = null;
            EmitProgress("summarizing", true);

            var sortedRoots = new List<RootAccumulator>(_roots);
            sortedRoots.Sort((left, right) =>
            {
                var bySize = right.SizeBytes.CompareTo(left.SizeBytes);
                return bySize != 0 ? bySize : string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase);
            });

            var topEntries = new List<EntryRecord>();
            for (var i = 0; i < Math.Min(_rootLimit, sortedRoots.Count); i++)
            {
                topEntries.Add(sortedRoots[i].ToEntryRecord());
            }

            var focusDirectories = new List<FocusDirectoryRecord>();
            var notableFiles = new List<EntryRecord>();

            foreach (var entry in topEntries)
            {
                if (entry.Type == "file")
                {
                    notableFiles.Add(entry);
                }
            }

            var focusCount = 0;
            foreach (var root in sortedRoots)
            {
                if (!root.IsDirectory)
                {
                    continue;
                }

                if (focusCount >= _focusLimit)
                {
                    break;
                }

                focusDirectories.Add(root.ToFocusDirectoryRecord(_childLimit));
                root.AppendTopFiles(notableFiles, TopFilesPerFocus);
                focusCount++;
            }

            var dedupedNotableFiles = new List<EntryRecord>();
            var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var file in notableFiles)
            {
                if (seenPaths.Add(file.Path))
                {
                    dedupedNotableFiles.Add(file);
                }
            }

            dedupedNotableFiles.Sort((left, right) => right.SizeBytes.CompareTo(left.SizeBytes));
            if (dedupedNotableFiles.Count > _fileLimit)
            {
                dedupedNotableFiles = dedupedNotableFiles.GetRange(0, _fileLimit);
            }

            var result = new ResultPayload
            {
                Drive = _driveLetter,
                Root = _rootPath,
                TopEntries = topEntries,
                FocusDirectories = focusDirectories,
                NotableFiles = dedupedNotableFiles,
                Stats = new ScanStatsPayload
                {
                    FilesVisited = _filesVisited,
                    DirectoriesVisited = _directoriesVisited,
                    BytesSeen = _bytesSeen,
                    RootsTotal = _rootsTotal,
                    RootsCompleted = _rootsCompleted,
                    ElapsedMs = _stopwatch.ElapsedMilliseconds
                }
            };

            Console.WriteLine("__RESULT__" + _serializer.Serialize(result));
        }

        private void ScanDirectoryTree(RootAccumulator root)
        {
            var stack = new Stack<ScanFrame>();
            stack.Push(new ScanFrame(root.Path, null, null, 0));

            while (stack.Count > 0)
            {
                var frame = stack.Pop();

                foreach (var item in NativeEnumerator.Enumerate(frame.Path))
                {
                    var fullPath = CombinePath(frame.Path, item.Name);
                    _currentPath = fullPath;

                    if (item.IsDirectory)
                    {
                        _directoriesVisited++;

                        if (item.IsReparsePoint)
                        {
                            MaybeEmitProgress();
                            continue;
                        }

                        if (frame.Depth == 0)
                        {
                            root.GetOrCreateChild(item.Name, fullPath, true);
                            stack.Push(new ScanFrame(fullPath, item.Name, fullPath, 1));
                        }
                        else
                        {
                            stack.Push(new ScanFrame(fullPath, frame.ImmediateChildName, frame.ImmediateChildPath, frame.Depth + 1));
                        }

                        MaybeEmitProgress();
                        continue;
                    }

                    _filesVisited++;
                    _bytesSeen += item.SizeBytes;
                    root.SizeBytes += item.SizeBytes;

                    if (frame.Depth == 0)
                    {
                        root.AddDirectFile(item.Name, fullPath, item.SizeBytes);
                    }
                    else
                    {
                        root.AddNestedFile(frame.ImmediateChildName, frame.ImmediateChildPath, item.Name, fullPath, item.SizeBytes);
                    }

                    root.AddTopFile(new FileEntry(item.Name, fullPath, item.SizeBytes));
                    MaybeEmitProgress();
                }
            }
        }

        private void MaybeEmitProgress()
        {
            if (_stopwatch.ElapsedMilliseconds - _lastProgressAtMs >= ProgressIntervalMs)
            {
                EmitProgress("scanning", false);
            }
        }

        private void EmitProgress(string phase, bool force)
        {
            if (!force && _stopwatch.ElapsedMilliseconds - _lastProgressAtMs < ProgressIntervalMs)
            {
                return;
            }

            _lastProgressAtMs = _stopwatch.ElapsedMilliseconds;

            double percent;
            if (_rootsTotal == 0)
            {
                percent = 100;
            }
            else if (string.Equals(phase, "scanning", StringComparison.OrdinalIgnoreCase) && _rootsCompleted < _rootsTotal && !string.IsNullOrEmpty(_currentRoot))
            {
                percent = Math.Min(99, ((_rootsCompleted + 0.5) / _rootsTotal) * 100.0);
            }
            else
            {
                percent = Math.Min(100, (_rootsCompleted / (double)Math.Max(_rootsTotal, 1)) * 100.0);
            }

            var payload = new ProgressPayload
            {
                Drive = _driveLetter,
                Phase = phase,
                Percent = Math.Round(percent, 1),
                RootsCompleted = _rootsCompleted,
                RootsTotal = _rootsTotal,
                FilesVisited = _filesVisited,
                DirectoriesVisited = _directoriesVisited,
                BytesSeen = _bytesSeen,
                CurrentRoot = _currentRoot,
                CurrentPath = _currentPath,
                ElapsedMs = _stopwatch.ElapsedMilliseconds
            };

            Console.WriteLine("__PROGRESS__" + _serializer.Serialize(payload));
        }

        private static string CombinePath(string left, string right)
        {
            if (left.EndsWith("\\", StringComparison.Ordinal))
            {
                return left + right;
            }

            return left + "\\" + right;
        }
    }

    internal sealed class RootAccumulator
    {
        private readonly Dictionary<string, ChildAccumulator> _children;
        private readonly List<FileEntry> _topFiles;

        public RootAccumulator(string name, string path, bool isDirectory)
        {
            Name = name;
            Path = path;
            IsDirectory = isDirectory;
            _children = new Dictionary<string, ChildAccumulator>(StringComparer.OrdinalIgnoreCase);
            _topFiles = new List<FileEntry>();
        }

        public string Name { get; private set; }
        public string Path { get; private set; }
        public bool IsDirectory { get; private set; }
        public long SizeBytes { get; set; }

        public EntryRecord ToEntryRecord()
        {
            return new EntryRecord
            {
                Name = Name,
                Path = Path,
                Type = IsDirectory ? "dir" : "file",
                Extension = IsDirectory ? null : System.IO.Path.GetExtension(Name),
                SizeBytes = SizeBytes
            };
        }

        public FocusDirectoryRecord ToFocusDirectoryRecord(int childLimit)
        {
            var children = new List<ChildAccumulator>(_children.Values);
            children.Sort((left, right) =>
            {
                var bySize = right.SizeBytes.CompareTo(left.SizeBytes);
                return bySize != 0 ? bySize : string.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase);
            });

            var result = new FocusDirectoryRecord
            {
                Name = Name,
                Path = Path,
                SizeBytes = SizeBytes,
                Children = new List<EntryRecord>()
            };

            for (var i = 0; i < Math.Min(childLimit, children.Count); i++)
            {
                result.Children.Add(children[i].ToEntryRecord());
            }

            return result;
        }

        public void AddDirectFile(string name, string path, long sizeBytes)
        {
            var child = GetOrCreateChild(name, path, false);
            child.SizeBytes += sizeBytes;
            child.AddTopFile(new FileEntry(name, path, sizeBytes));
        }

        public void AddNestedFile(string immediateChildName, string immediateChildPath, string fileName, string filePath, long sizeBytes)
        {
            if (string.IsNullOrEmpty(immediateChildName) || string.IsNullOrEmpty(immediateChildPath))
            {
                return;
            }

            var child = GetOrCreateChild(immediateChildName, immediateChildPath, true);
            child.SizeBytes += sizeBytes;
            child.AddTopFile(new FileEntry(fileName, filePath, sizeBytes));
        }

        public ChildAccumulator GetOrCreateChild(string name, string path, bool isDirectory)
        {
            ChildAccumulator value;
            if (_children.TryGetValue(path, out value))
            {
                return value;
            }

            value = new ChildAccumulator(name, path, isDirectory);
            _children[path] = value;
            return value;
        }

        public void AddTopFile(FileEntry file)
        {
            _topFiles.Add(file);
            _topFiles.Sort((left, right) => right.SizeBytes.CompareTo(left.SizeBytes));
            if (_topFiles.Count > 6)
            {
                _topFiles.RemoveRange(6, _topFiles.Count - 6);
            }
        }

        public void AppendTopFiles(List<EntryRecord> destination, int take)
        {
            for (var i = 0; i < Math.Min(take, _topFiles.Count); i++)
            {
                destination.Add(_topFiles[i].ToEntryRecord());
            }
        }
    }

    internal sealed class ChildAccumulator
    {
        private readonly List<FileEntry> _topFiles;

        public ChildAccumulator(string name, string path, bool isDirectory)
        {
            Name = name;
            Path = path;
            IsDirectory = isDirectory;
            _topFiles = new List<FileEntry>();
        }

        public string Name { get; private set; }
        public string Path { get; private set; }
        public bool IsDirectory { get; private set; }
        public long SizeBytes { get; set; }

        public void AddTopFile(FileEntry file)
        {
            _topFiles.Add(file);
            _topFiles.Sort((left, right) => right.SizeBytes.CompareTo(left.SizeBytes));
            if (_topFiles.Count > 2)
            {
                _topFiles.RemoveRange(2, _topFiles.Count - 2);
            }
        }

        public EntryRecord ToEntryRecord()
        {
            return new EntryRecord
            {
                Name = Name,
                Path = Path,
                Type = IsDirectory ? "dir" : "file",
                Extension = IsDirectory ? null : System.IO.Path.GetExtension(Name),
                SizeBytes = SizeBytes
            };
        }
    }

    internal sealed class FileEntry
    {
        public FileEntry(string name, string path, long sizeBytes)
        {
            Name = name;
            Path = path;
            SizeBytes = sizeBytes;
        }

        public string Name { get; private set; }
        public string Path { get; private set; }
        public long SizeBytes { get; private set; }

        public EntryRecord ToEntryRecord()
        {
            return new EntryRecord
            {
                Name = Name,
                Path = Path,
                Type = "file",
                Extension = System.IO.Path.GetExtension(Name),
                SizeBytes = SizeBytes
            };
        }
    }

    internal sealed class ScanFrame
    {
        public ScanFrame(string path, string immediateChildName, string immediateChildPath, int depth)
        {
            Path = path;
            ImmediateChildName = immediateChildName;
            ImmediateChildPath = immediateChildPath;
            Depth = depth;
        }

        public string Path { get; private set; }
        public string ImmediateChildName { get; private set; }
        public string ImmediateChildPath { get; private set; }
        public int Depth { get; private set; }
    }

    internal sealed class FindItem
    {
        public FindItem(string name, bool isDirectory, bool isReparsePoint, long sizeBytes)
        {
            Name = name;
            IsDirectory = isDirectory;
            IsReparsePoint = isReparsePoint;
            SizeBytes = sizeBytes;
        }

        public string Name { get; private set; }
        public bool IsDirectory { get; private set; }
        public bool IsReparsePoint { get; private set; }
        public long SizeBytes { get; private set; }
    }

    public sealed class EntryRecord
    {
        public string Name { get; set; }
        public string Path { get; set; }
        public string Type { get; set; }
        public string Extension { get; set; }
        public long SizeBytes { get; set; }
    }

    public sealed class FocusDirectoryRecord
    {
        public string Name { get; set; }
        public string Path { get; set; }
        public long SizeBytes { get; set; }
        public List<EntryRecord> Children { get; set; }
    }

    public sealed class ScanStatsPayload
    {
        public long FilesVisited { get; set; }
        public long DirectoriesVisited { get; set; }
        public long BytesSeen { get; set; }
        public int RootsTotal { get; set; }
        public int RootsCompleted { get; set; }
        public long ElapsedMs { get; set; }
    }

    public sealed class ResultPayload
    {
        public string Drive { get; set; }
        public string Root { get; set; }
        public List<EntryRecord> TopEntries { get; set; }
        public List<FocusDirectoryRecord> FocusDirectories { get; set; }
        public List<EntryRecord> NotableFiles { get; set; }
        public ScanStatsPayload Stats { get; set; }
    }

    public sealed class ProgressPayload
    {
        public string Drive { get; set; }
        public string Phase { get; set; }
        public double Percent { get; set; }
        public int RootsCompleted { get; set; }
        public int RootsTotal { get; set; }
        public long FilesVisited { get; set; }
        public long DirectoriesVisited { get; set; }
        public long BytesSeen { get; set; }
        public string CurrentRoot { get; set; }
        public string CurrentPath { get; set; }
        public long ElapsedMs { get; set; }
    }

    internal static class NativeEnumerator
    {
        private const int FindExInfoStandard = 0;
        private const int FindExSearchNameMatch = 0;
        private const int FindFirstExLargeFetch = 2;
        private const int FileAttributeDirectory = 0x10;
        private const int FileAttributeReparsePoint = 0x400;

        public static IEnumerable<FindItem> Enumerate(string directoryPath)
        {
            var normalizedDirectory = NormalizeLongPath(directoryPath).TrimEnd('\\');
            var searchPath = normalizedDirectory + "\\*";
            WIN32_FIND_DATA data;
            var handle = FindFirstFileExW(
                searchPath,
                FindExInfoStandard,
                out data,
                FindExSearchNameMatch,
                IntPtr.Zero,
                FindFirstExLargeFetch);

            if (handle == INVALID_HANDLE_VALUE)
            {
                yield break;
            }

            try
            {
                while (true)
                {
                    if (data.cFileName != "." && data.cFileName != "..")
                    {
                        var isDirectory = (data.dwFileAttributes & FileAttributeDirectory) == FileAttributeDirectory;
                        var isReparsePoint = (data.dwFileAttributes & FileAttributeReparsePoint) == FileAttributeReparsePoint;
                        var size = ((long)data.nFileSizeHigh << 32) | data.nFileSizeLow;

                        yield return new FindItem(data.cFileName, isDirectory, isReparsePoint, size);
                    }

                    if (!FindNextFileW(handle, out data))
                    {
                        break;
                    }
                }
            }
            finally
            {
                FindClose(handle);
            }
        }

        private static string NormalizeLongPath(string path)
        {
            if (path.StartsWith(@"\\?\"))
            {
                return path;
            }

            if (path.StartsWith(@"\\"))
            {
                return @"\\?\UNC\" + path.Substring(2);
            }

            return @"\\?\" + path;
        }

        private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr FindFirstFileExW(
            string lpFileName,
            int fInfoLevelId,
            out WIN32_FIND_DATA lpFindFileData,
            int fSearchOp,
            IntPtr lpSearchFilter,
            int dwAdditionalFlags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindNextFileW(
            IntPtr hFindFile,
            out WIN32_FIND_DATA lpFindFileData);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindClose(IntPtr hFindFile);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WIN32_FIND_DATA
        {
            public uint dwFileAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint dwReserved0;
            public uint dwReserved1;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string cFileName;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
            public string cAlternateFileName;
        }
    }
}
