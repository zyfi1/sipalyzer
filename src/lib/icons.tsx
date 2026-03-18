/**
 * Central icon exports using Lucide icons.
 * We keep the existing export names as a compatibility layer so
 * call-sites can continue importing from `@/lib/icons` unchanged.
 */
import * as React from "react";
import * as Lu from "lucide-react";
import { cn } from "@/lib/utils";

const {
  Activity: LuActivity,
  AlertCircle: LuAlertCircle,
  AlertTriangle: LuAlertTriangle,
  ArrowDownToLine: LuArrowDownToLine,
  ArrowLeft: LuArrowLeft,
  ArrowLeftRight: LuArrowLeftRight,
  ArrowRight: LuArrowRight,
  ArrowUpFromLine: LuArrowUpFromLine,
  BarChart3: LuBarChart3,
  Bell: LuBell,
  BellRing: LuBellRing,
  Bold: LuBold,
  Bookmark: LuBookmark,
  BookOpen: LuBookOpen,
  Calculator: LuCalculator,
  Calendar: LuCalendar,
  CalendarClock: LuCalendarClock,
  Check: LuCheck,
  CheckCircle: LuCheckCircle,
  CheckCircle2: LuCheckCircle2,
  ChevronDown: LuChevronDown,
  ChevronLeft: LuChevronLeft,
  ChevronRight: LuChevronRight,
  ChevronUp: LuChevronUp,
  ChevronsUpDown: LuChevronsUpDown,
  Circle: LuCircle,
  CircleArrowOutDownRight: LuCircleArrowOutDownRight,
  Clipboard: LuClipboard,
  ClipboardList: LuClipboardList,
  Clock: LuClock,
  Cloud: LuCloud,
  CloudFog: LuCloudFog,
  CloudLightning: LuCloudLightning,
  CloudMoon: LuCloudMoon,
  CloudRain: LuCloudRain,
  CloudSnow: LuCloudSnow,
  CloudSun: LuCloudSun,
  Code: LuCode,
  Copy: LuCopy,
  Database: LuDatabase,
  Delete: LuDelete,
  Download: LuDownload,
  Droplet: LuDroplet,
  Ellipsis: LuEllipsis,
  EllipsisVertical: LuEllipsisVertical,
  Eraser: LuEraser,
  ExternalLink: LuExternalLink,
  Eye: LuEye,
  EyeOff: LuEyeOff,
  File: LuFile,
  FileCode: LuFileCode,
  FileImage: LuFileImage,
  FileJson: LuFileJson,
  FileSearch: LuFileSearch,
  FileText: LuFileText,
  FileType: LuFileType,
  FileUp: LuFileUp,
  Filter: LuFilter,
  Folder: LuFolder,
  FolderOpen: LuFolderOpen,
  FolderPlus: LuFolderPlus,
  Gauge: LuGauge,
  GitBranch: LuGitBranch,
  GitCompare: LuGitCompare,
  GitFork: LuGitFork,
  Globe: LuGlobe,
  GlobeLock: LuGlobeLock,
  GripHorizontal: LuGripHorizontal,
  GripVertical: LuGripVertical,
  HardDrive: LuHardDrive,
  Hash: LuHash,
  Heading1: LuHeading1,
  Heading2: LuHeading2,
  Heading3: LuHeading3,
  Hammer: LuHammer,
  Headphones: LuHeadphones,
  HelpCircle: LuHelpCircle,
  History: LuHistory,
  Home: LuHome,
  Image: LuImage,
  Inbox: LuInbox,
  Info: LuInfo,
  Italic: LuItalic,
  Keyboard: LuKeyboard,
  KeyRound: LuKeyRound,
  Laptop: LuLaptop,
  Layers: LuLayers,
  LayoutDashboard: LuLayoutDashboard,
  LayoutGrid: LuLayoutGrid,
  Lightbulb: LuLightbulb,
  Link: LuLink,
  Link2: LuLink2,
  Link2Off: LuLink2Off,
  List: LuList,
  ListFilter: LuListFilter,
  ListOrdered: LuListOrdered,
  Loader2: LuLoader2,
  Lock: LuLock,
  LogIn: LuLogIn,
  LogOut: LuLogOut,
  MapPin: LuMapPin,
  Maximize2: LuMaximize2,
  Mic: LuMic,
  MicOff: LuMicOff,
  Minimize2: LuMinimize2,
  Minus: LuMinus,
  Monitor: LuMonitor,
  Moon: LuMoon,
  Music: LuMusic,
  Network: LuNetwork,
  Package: LuPackage,
  Palette: LuPalette,
  PanelLeft: LuPanelLeft,
  PanelLeftClose: LuPanelLeftClose,
  PanelLeftOpen: LuPanelLeftOpen,
  PanelRightClose: LuPanelRightClose,
  PanelRightOpen: LuPanelRightOpen,
  PanelTopClose: LuPanelTopClose,
  PanelTopOpen: LuPanelTopOpen,
  PanelTop: LuPanelTop,
  Pause: LuPause,
  Pencil: LuPencil,
  PenLine: LuPenLine,
  Pin: LuPin,
  Phone: LuPhone,
  PhoneOff: LuPhoneOff,
  Play: LuPlay,
  PlayCircle: LuPlayCircle,
  Plug: LuPlug,
  Plus: LuPlus,
  Power: LuPower,
  Printer: LuPrinter,
  Quote: LuQuote,
  Radar: LuRadar,
  Radio: LuRadio,
  Redo2: LuRedo2,
  RefreshCw: LuRefreshCw,
  RemoveFormatting: LuRemoveFormatting,
  Repeat: LuRepeat,
  RotateCcw: LuRotateCcw,
  Satellite: LuSatellite,
  Save: LuSave,
  Scissors: LuScissors,
  Search: LuSearch,
  Send: LuSend,
  Settings: LuSettings,
  Shield: LuShield,
  Smartphone: LuSmartphone,
  Sparkles: LuSparkles,
  Square: LuSquare,
  SquareCheck: LuSquareCheck,
  SquareTerminal: LuSquareTerminal,
  Star: LuStar,
  StickyNote: LuStickyNote,
  Strikethrough: LuStrikethrough,
  Sun: LuSun,
  Table: LuTable,
  Tag: LuTag,
  Terminal: LuTerminal,
  TestTube: LuTestTube,
  Thermometer: LuThermometer,
  Timer: LuTimer,
  ToggleLeft: LuToggleLeft,
  Trash2: LuTrash2,
  TrendingUp: LuTrendingUp,
  Trophy: LuTrophy,
  Undo2: LuUndo2,
  Upload: LuUpload,
  User: LuUser,
  Video: LuVideo,
  Volume2: LuVolume2,
  VolumeX: LuVolumeX,
  Wifi: LuWifi,
  Wind: LuWind,
  Wrench: LuWrench,
  X: LuX,
  XCircle: LuXCircle,
  Zap: LuZap,
} = new Proxy(
  {},
  {
    get: (_, prop) => String(prop),
  },
) as any;

// ── Types ───────────────────────────────────────────────────────────────────

type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number;
  // Kept for compatibility with previous backend API.
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  filled?: boolean;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
};

const ICON_ALIASES: Record<string, string[]> = {
  ChevronDown: ["CaretDown"],
  ChevronLeft: ["CaretLeft"],
  ChevronRight: ["CaretRight"],
  ChevronUp: ["CaretUp"],
  ClipboardList: ["ListDetails", "ClipboardText", "Clipboard"],
  Droplet: ["Droplet", "DropletFilled"],
  ExternalLink: ["ExternalLink"],
  EyeOff: ["EyeOff"],
  AlertCircle: ["AlertCircle"],
  AlertTriangle: ["AlertTriangle"],
  BookOpen: ["Book", "Books"],
  ArrowDownToLine: ["ArrowBarToDown", "ArrowDown"],
  ArrowLeftRight: ["ArrowsLeftRight"],
  ArrowUpFromLine: ["ArrowBarToUp", "ArrowUp"],
  BarChart3: ["ChartBar", "ChartBarPopular"],
  BellRing: ["BellRinging", "Bell"],
  CalendarClock: ["Calendar", "Clock"],
  CheckCircle: ["CircleCheck", "Check"],
  CheckCircle2: ["CircleCheck", "CheckCircle"],
  ChevronsUpDown: ["Selector", "ArrowsUpDown"],
  CircleArrowOutDownRight: ["ArrowDownRightCircle"],
  CloudFog: ["CloudFog", "Cloud"],
  CloudLightning: ["CloudStorm", "CloudBolt", "Cloud"],
  CloudMoon: ["CloudMoon", "Moon", "Cloud"],
  CloudRain: ["CloudRain", "Cloud"],
  CloudSnow: ["Cloud", "Snowflake"],
  CloudSun: ["CloudSun", "Sun", "Cloud"],
  Delete: ["Backspace"],
  Ellipsis: ["Dots"],
  EllipsisVertical: ["DotsVertical"],
  FileCode: ["FileCode", "File"],
  FileImage: ["FileImage", "File"],
  FileJson: ["FileTypeJson", "FileCode", "FileText", "File"],
  FileSearch: ["FileSearch", "Search", "File"],
  FileType: ["FileText", "File"],
  FileUp: ["FileUpload", "Upload", "File"],
  Filter: ["Filter", "FilterFilled"],
  Gauge: ["Gauge", "BrandSpeedtest", "ChartArcs"],
  GitCompare: ["GitCompare", "GitPullRequest", "ArrowsLeftRight"],
  GitFork: ["GitFork", "TreeStructure"],
  GlobeLock: ["MapLock", "ShieldLock", "World", "Lock"],
  GripHorizontal: ["GripHorizontal", "GripVertical"],
  GripVertical: ["GripVertical", "GripHorizontal"],
  Heading1: ["H1"],
  Heading2: ["H2"],
  Heading3: ["H3"],
  HardDrive: ["DeviceSdCard", "Database"],
  HelpCircle: ["HelpCircle", "HelpHexagon", "Help"],
  History: ["ClockCounterClockwise", "ArrowCounterClockwise"],
  Home: ["Home"],
  Image: ["Photo", "PhotoSquareRounded", "PhotoCircle"],
  Inbox: ["Inbox", "Archive"],
  Info: ["InfoCircle", "InfoSquareRounded", "InfoSquare"],
  Italic: ["Italic"],
  KeyRound: ["Key"],
  Layers: ["LayersIntersect", "LayersDifference", "LayersSubtract", "LayersSelected"],
  LayoutDashboard: ["LayoutDashboard", "Dashboard"],
  LayoutGrid: ["LayoutGrid", "GridDots"],
  Link2: ["Link", "LinkPlus"],
  Link2Off: ["LinkOff", "Unlink"],
  ListFilter: ["Filter", "FilterFilled"],
  ListOrdered: ["ListNumbers"],
  Loader2: ["Loader2", "Loader", "Progress"],
  LockSquareRounded: ["Lock", "Shield"],
  LogIn: ["Login", "ArrowRight"],
  LogOut: ["Logout", "ArrowLeft"],
  Laptop: ["DeviceLaptop", "DeviceDesktop"],
  Lightbulb: ["Bulb", "BulbFilled", "BulbOff"],
  Maximize2: ["Maximize", "ArrowsMaximize"],
  Mic: ["Microphone"],
  MicOff: ["MicrophoneOff", "Microphone"],
  Minimize2: ["Minimize", "ArrowsMinimize"],
  Monitor: ["DeviceDesktop", "DeviceHeartMonitor"],
  Music: ["Music", "MusicOff"],
  Pause: ["PlayerPause", "PlayerPauseFilled"],
  PanelLeft: ["LayoutSidebarLeftCollapse", "LayoutSidebarLeftExpand", "LayoutSidebarLeft"],
  PanelLeftClose: ["LayoutSidebarLeftCollapse", "LayoutSidebarLeft"],
  PanelLeftOpen: ["LayoutSidebarLeftExpand", "LayoutSidebarLeft"],
  LayoutSidebarRight: ["PanelRight", "PanelLeft"],
  PanelRightClose: ["LayoutSidebarRightCollapse", "LayoutSidebarRight"],
  PanelRightOpen: ["LayoutSidebarRightExpand", "LayoutSidebarRight"],
  PanelTop: ["LayoutNavbar"],
  PanelTopClose: ["LayoutNavbarCollapse", "LayoutNavbar"],
  PanelTopOpen: ["LayoutNavbarExpand", "LayoutNavbar"],
  PenLine: ["Pencil", "PencilMinus"],
  Pin: ["Pin", "Pinned"],
  PhoneOff: ["PhoneX", "PhoneDisconnect", "Phone"],
  PlayCircle: ["PlayerPlay", "PlayCard", "PlayCardFilled", "PlaystationCircle"],
  Play: ["PlayerPlay", "PlayerPlayFilled"],
  Quote: ["Quote"],
  Radar: ["Radar", "Broadcast"],
  Redo2: ["ArrowForwardUp", "RotateClockwise2", "RotateClockwise", "ArrowClockwise", "ArrowCounterClockwise"],
  RefreshCw: ["Refresh", "RotateClockwise"],
  RemoveFormatting: ["ClearFormatting", "TextWrapDisabled"],
  Repeat: ["Repeat"],
  RotateCcw: ["Rotate", "Rotate2", "ArrowCounterClockwise"],
  Satellite: ["Satellite", "AntennaBars5"],
  Save: ["DeviceFloppy", "FileUpload"],
  Search: ["Search"],
  Send: ["Send", "Send2"],
  Settings: ["Settings", "Adjustments"],
  Smartphone: ["DeviceMobile", "Phone"],
  Sparkles: ["Sparkles", "Stars"],
  SquareCheck: ["CheckSquare"],
  SquareTerminal: ["Terminal2", "Terminal"],
  StickyNote: ["Note", "Notebook"],
  Strikethrough: ["Strikethrough"],
  TestTube: ["Flask", "TestTube"],
  ToggleLeft: ["ToggleLeft", "ToggleRight"],
  Trash2: ["Trash", "TrashSimple"],
  TrendingUp: ["TrendingUp"],
  Timer: ["Stopwatch", "ClockHour4", "Clock"],
  Undo2: ["ArrowBackUp", "Rotate2", "ArrowCounterClockwise", "ArrowClockwise"],
  Video: ["Video", "VideoPlus"],
  Volume2: ["Volume", "Volume2"],
  VolumeX: ["VolumeOff", "Volume3"],
  Wifi: ["Wifi", "WifiOff"],
  WifiNone: ["WifiOff", "WifiZero"],
  Wrench: ["Tool", "Tools", "Hammer"],
  XCircle: ["CircleX", "Cancel", "XboxX", "Prohibit"],
  Zap: ["Bolt", "BoltOff"],
  CellTower: ["AntennaBars5", "CellSignal5"],
};

// ── Wrapper ─────────────────────────────────────────────────────────────────

function resolveIcon(token: string) {
  const candidates = [token, ...(ICON_ALIASES[token] ?? []), "CircleHelp", "HelpCircle", "Circle"];
  for (const name of candidates) {
    const pascal = name.replace(/[^a-zA-Z0-9]/g, "");
    const exact = (Lu as Record<string, unknown>)[pascal];
    if (typeof exact === "function" || (typeof exact === "object" && exact !== null)) {
      return exact as React.ComponentType<Record<string, unknown>>;
    }
  }
  return ((Lu as Record<string, unknown>).CircleHelp ||
    (Lu as Record<string, unknown>).HelpCircle ||
    (Lu as Record<string, unknown>).Circle) as React.ComponentType<Record<string, unknown>>;
}

function createIcon(iconToken?: string) {
  const Wrapped = React.forwardRef<SVGSVGElement, IconProps>(
    function LucideIconWrapper(props, ref) {
      const {
        size = 24,
        className,
        filled: _filled,
        strokeWidth,
        absoluteStrokeWidth = true,
        weight: _weight,
        ...rest
      } = props;
      const token = iconToken ?? "CircleHelp";
      const Icon = resolveIcon(token);
      const resolvedStroke =
        typeof strokeWidth === "number" ? strokeWidth : strokeWidth ? Number(strokeWidth) : 1.9;
      return (
        <Icon
          ref={ref}
          size={size}
          strokeWidth={Number.isFinite(resolvedStroke) ? resolvedStroke : 1.9}
          absoluteStrokeWidth={absoluteStrokeWidth}
          className={cn("app-icon", className)}
          {...rest}
        />
      );
    },
  );
  Wrapped.displayName = `LucideIcon(${iconToken})`;
  return Wrapped;
}

// ── Exports (alphabetical by export name) ───────────────────────────────────

export const Activity = createIcon(LuActivity);
export const AlertCircle = createIcon(LuAlertCircle);
export const AlertTriangle = createIcon(LuAlertTriangle);
export const ArrowDown = createIcon(LuChevronDown);
export const ArrowDownToLine = createIcon(LuArrowDownToLine);
export const ArrowLeft = createIcon(LuArrowLeft);
export const ArrowRight = createIcon(LuArrowRight);
export const ArrowRightLeft = createIcon(LuArrowLeftRight);
export const ArrowUp = createIcon(LuChevronUp);
export const ArrowUpDown = createIcon(LuChevronsUpDown);
export const ArrowUpFromLine = createIcon(LuArrowUpFromLine);
export const Award = createIcon(LuTrophy);

export const Backspace = createIcon(LuDelete);
export const BarChart3 = createIcon(LuBarChart3);
export const Bell = createIcon(LuBell);
export const BellRing = createIcon(LuBellRing);
export const Bold = createIcon(LuBold);
export const Bookmark = createIcon(LuBookmark);
export const BookOpen = createIcon(LuBookOpen);

export const Calculator = createIcon(LuCalculator);
export const Calendar = createIcon(LuCalendar);
export const CalendarClock = createIcon(LuCalendarClock);
export const CaretUpDown = createIcon(LuChevronsUpDown);
export const Check = createIcon(LuCheck);
export const CheckCheck = createIcon(LuCheckCircle);
export const CheckCircle = createIcon(LuCheckCircle);
export const CheckCircle2 = createIcon(LuCheckCircle2);
export const CheckIcon = createIcon(LuCheck);
export const CheckmarkSquare01 = createIcon(LuSquareCheck);
export const CheckSquare = createIcon(LuSquareCheck);
export const ChevronDown = createIcon(LuChevronDown);
export const ChevronDownIcon = createIcon(LuChevronDown);
export const ChevronLeft = createIcon(LuChevronLeft);
export const ChevronRight = createIcon(LuChevronRight);
export const ChevronRightIcon = createIcon(LuChevronRight);
export const ChevronUp = createIcon(LuChevronUp);
export const ChevronUpIcon = createIcon(LuChevronUp);
export const Circle = createIcon(LuCircle);
export const CircleArrowOutDownRight = createIcon(LuCircleArrowOutDownRight);
export const CircleIcon = createIcon(LuCircle);
export const Clipboard = createIcon(LuClipboard);
export const ClipboardList = createIcon(LuClipboardList);
export const ClipboardPaste = createIcon(LuClipboard);
export const Clock = createIcon(LuClock);
export const Cloud = createIcon(LuCloud);
export const CloudFog = createIcon(LuCloudFog);
export const CloudLightning = createIcon(LuCloudLightning);
export const CloudMoon = createIcon(LuCloudMoon);
export const CloudRain = createIcon(LuCloudRain);
export const CloudSun = createIcon(LuCloudSun);
export const Code = createIcon(LuCode);
export const Copy = createIcon(LuCopy);
export const CopyIcon = createIcon(LuCopy);

export const Desktop = createIcon(LuMonitor);
export const Download = createIcon(LuDownload);
export const Drop = createIcon(LuDroplet);

export const Edit = createIcon(LuPencil);
export const Eraser = createIcon(LuEraser);
export const ExternalLink = createIcon(LuExternalLink);
export const Eye = createIcon(LuEye);
export const EyeOff = createIcon(LuEyeOff);

export const File = createIcon(LuFile);
export const FileCode = createIcon(LuFileCode);
export const FileImage = createIcon(LuFileImage);
export const FileJson = createIcon(LuFileJson);
export const FileList = createIcon(LuList);
export const FilePdf = createIcon(LuFileType);
export const FileSearch = createIcon(LuFileSearch);
export const FileText = createIcon(LuFileText);
export const FileUp = createIcon(LuFileUp);
export const Filter = createIcon(LuFilter);
export const Folder = createIcon(LuFolder);
export const FolderOpen = createIcon(LuFolderOpen);
export const FolderPlus = createIcon(LuFolderPlus);

export const Gauge = createIcon(LuGauge);
export const GitBranch = createIcon(LuGitBranch);
export const GitCompareArrows = createIcon(LuGitCompare);
export const Globe = createIcon(LuGlobe);
export const GlobeLock = createIcon(LuGlobeLock);
export const Grid3x3 = createIcon(LuLayoutGrid);
export const GripHorizontal = createIcon(LuGripHorizontal);
export const GripVertical = createIcon(LuGripVertical);

export const HardDrive = createIcon(LuHardDrive);
export const Hash = createIcon(LuHash);
export const Heading1 = createIcon(LuHeading1);
export const Heading2 = createIcon(LuHeading2);
export const Heading3 = createIcon(LuHeading3);
export const Headphones = createIcon(LuHeadphones);
export const HelpCircle = createIcon(LuHelpCircle);
export const History = createIcon(LuHistory);
export const Home = createIcon(LuHome);

export const Image = createIcon(LuImage);
export const Inbox = createIcon(LuInbox);
export const Info = createIcon(LuInfo);
export const Italic = createIcon(LuItalic);

export const Keyboard = createIcon(LuKeyboard);

export const Laptop = createIcon(LuLaptop);
export const Layers = createIcon(LuLayers);
export const LayoutDashboard = createIcon(LuLayoutDashboard);
export const Lightbulb = createIcon(LuLightbulb);
export const Link2 = createIcon(LuLink2);
export const LinkConnect = createIcon(LuLink2);
export const LinkDisconnect = createIcon(LuLink2Off);
export const LinkIcon = createIcon(LuLink);
export const List = createIcon(LuList);
export const ListOrdered = createIcon(LuListOrdered);
export const Loader2 = createIcon(LuLoader2);
export const Loader2Icon = createIcon(LuLoader2);
export const Lock = createIcon(LuLock);
export const LockSquareRounded = createIcon("LockSquareRounded");
export const LogIn = createIcon(LuLogIn);
export const LogOut = createIcon(LuLogOut);

export const MagnifyingGlass = createIcon(LuSearch);
export const MapPin = createIcon(LuMapPin);
export const MaximizeScreen = createIcon(LuMaximize2);
export const MenuSearch = createIcon(LuListFilter);
export const Mic = createIcon(LuMic);
export const Mic2 = createIcon(LuMic);
export const MicOff = createIcon(LuMicOff);
export const MinimizeScreen = createIcon(LuMinimize2);
export const Minus = createIcon(LuMinus);
export const Monitor = createIcon(LuMonitor);
export const Moon = createIcon(LuMoon);
export const MoreHorizontal = createIcon(LuEllipsis);
export const MoreVertical = createIcon(LuEllipsisVertical);
export const MusicNote = createIcon(LuMusic);

export const Network = createIcon(LuNetwork);

export const Package = createIcon(LuPackage);
export const Palette = createIcon(LuPalette);
export const PanelBottom = createIcon(LuPanelTop);
export const PanelLeft = createIcon(LuPanelLeft);
export const PanelLeftClose = createIcon(LuPanelLeftClose);
export const PanelLeftOpen = createIcon(LuPanelLeftOpen);
export const PanelRight = createIcon("LayoutSidebarRight");
export const PanelRightClose = createIcon(LuPanelRightClose);
export const PanelRightOpen = createIcon(LuPanelRightOpen);
export const PanelTop = createIcon(LuPanelTop);
export const PanelTopClose = createIcon(LuPanelTopClose);
export const PanelTopOpen = createIcon(LuPanelTopOpen);
export const Pin = createIcon(LuPin);
export const Password = createIcon(LuKeyRound);
export const Pause = createIcon(LuPause);
export const PencilSimple = createIcon(LuPenLine);
export const Phone = createIcon(LuPhone);
export const PhoneCall = createIcon(LuPhone);
export const PhoneOff = createIcon(LuPhoneOff);
export const PhoneOffIcon = createIcon(LuPhoneOff);
export const Play = createIcon(LuPlay);
export const PlayCircle = createIcon(LuPlayCircle);
export const Plugs = createIcon(LuPlug);
export const Plus = createIcon(LuPlus);
export const Power = createIcon(LuPower);
export const PowerOff = createIcon(LuPower);
export const Printer = createIcon(LuPrinter);

export const Quote = createIcon(LuQuote);

export const Radio = createIcon(LuRadio);
export const Redo = createIcon(LuRedo2);
export const RefreshCw = createIcon(LuRefreshCw);
export const RemoveFormatting = createIcon(LuRemoveFormatting);
export const Repeat = createIcon(LuRepeat);
export const RotateCcw = createIcon(LuRotateCcw);

export const Save = createIcon(LuSave);
export const Satellite = createIcon(LuSatellite);
export const Scan = createIcon(LuRadar);
export const Scissors = createIcon(LuScissors);
export const Search = createIcon(LuSearch);
export const SearchIcon = createIcon(LuSearch);
export const Send = createIcon(LuSend);
export const Server = createIcon(LuDatabase);
export const Settings = createIcon(LuSettings);
export const Settings2 = createIcon(LuSettings);
export const Shield = createIcon(LuShield);
export const SidebarToggle = createIcon(LuPanelLeft);
export const Smartphone = createIcon(LuSmartphone);
export const Snowflake = createIcon(LuCloudSnow);
export const Sparkles = createIcon(LuSparkles);
export const Square = createIcon(LuSquare);
export const SshKey = createIcon(LuKeyRound);
export const Star = createIcon(LuStar);
export const StickyNote = createIcon(LuStickyNote);
export const StopIcon = createIcon(LuSquare);
export const Strikethrough = createIcon(LuStrikethrough);
export const Sun = createIcon(LuSun);

export const Table = createIcon(LuTable);
export const Tag = createIcon(LuTag);
export const Terminal = createIcon(LuTerminal);
export const TestTube = createIcon(LuTestTube);
export const Thermometer = createIcon(LuThermometer);
export const Tick = createIcon(LuCheck);
export const Timer = createIcon(LuTimer);
export const ToggleLeft = createIcon(LuToggleLeft);
export const SquareTerminal = createIcon(LuSquareTerminal);
export const Toolbox = createIcon(LuHammer);
export const Trash = createIcon(LuTrash2);
export const Trash2 = createIcon(LuTrash2);
export const TreeStructure = createIcon(LuGitFork);
export const TrendingUp = createIcon(LuTrendingUp);
export const Trophy = createIcon(LuTrophy);

export const Undo = createIcon(LuUndo2);
export const Upload = createIcon(LuUpload);
export const User = createIcon(LuUser);
export const Users = createIcon(LuUser);

export const VideoCamera = createIcon(LuVideo);
export const Volume2 = createIcon(LuVolume2);
export const VolumeMute = createIcon(LuVolumeX);

export const Wifi = createIcon(LuWifi);
export const WifiHigh = createIcon("WifiHigh");
export const WifiMedium = createIcon("Wifi");
export const WifiLow = createIcon("WifiLow");
export const WifiNone = createIcon("WifiNone");
export const Wind = createIcon(LuWind);
export const Wrench = createIcon(LuWrench);

export const X = createIcon(LuX);
export const XCircle = createIcon(LuXCircle);
export const XIcon = createIcon(LuX);

export const Zap = createIcon(LuZap);

// ── Platform logos (not in Lucide — custom SVG) ─────────────────────────────

export const WindowsLogo = React.forwardRef<SVGSVGElement, IconProps>(
  function WindowsLogo({ size = 24, className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cn("app-icon", className)}
        {...props}
      >
        <path d="M3 5.548l7.514-1.04v7.254H3V5.548zm0 12.904l7.514 1.04v-7.254H3v6.214zm8.486 1.16L21 21V12.248h-9.514v7.364zm0-15.224v7.374H21V3l-9.514 1.388z" />
      </svg>
    );
  },
);
WindowsLogo.displayName = "WindowsLogo";

export const AppleLogo = React.forwardRef<SVGSVGElement, IconProps>(
  function AppleLogo({ size = 24, className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cn("app-icon", className)}
        {...props}
      >
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    );
  },
);
AppleLogo.displayName = "AppleLogo";

export const LinuxLogo = React.forwardRef<SVGSVGElement, IconProps>(
  function LinuxLogo({ size = 24, className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className={cn("app-icon", className)}
        {...props}
      >
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
      </svg>
    );
  },
);
LinuxLogo.displayName = "LinuxLogo";

// ── Type export ─────────────────────────────────────────────────────────────

export type IconComponent = React.ComponentType<IconProps>;
