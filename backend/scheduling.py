from datetime import datetime, timedelta

def parse_iso(dt_str):
    if isinstance(dt_str, datetime):
        return dt_str
    try:
        # Support both standard ISO format and simple replacements if needed
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except Exception:
        # Fallback for simple date formats
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(dt_str, fmt)
            except ValueError:
                continue
        raise ValueError(f"Unknown datetime format: {dt_str}")

def find_overlap(parent_avail, clinician_avail, monitor_avail, duration_hours=1):
    """
    Finds the first overlapping datetime window of at least `duration_hours` hours
    among the parent, clinician, and court monitor.
    Each input is a list of dicts: [{"start": "ISO_STR", "end": "ISO_STR"}, ...]
    """
    min_duration = timedelta(hours=duration_hours)
    
    # Inner helper to intersect two lists of intervals
    def intersect_two_lists(list1, list2):
        intersections = []
        for int1 in list1:
            try:
                s1 = parse_iso(int1["start"])
                e1 = parse_iso(int1["end"])
            except Exception:
                continue
            for int2 in list2:
                try:
                    s2 = parse_iso(int2["start"])
                    e2 = parse_iso(int2["end"])
                except Exception:
                    continue
                
                overlap_start = max(s1, s2)
                overlap_end = min(e1, e2)
                
                if overlap_end - overlap_start >= min_duration:
                    intersections.append({
                        "start": overlap_start,
                        "end": overlap_end
                    })
        return intersections

    # Step 1: Intersect parent and clinician
    pc_overlap = intersect_two_lists(parent_avail, clinician_avail)
    
    # Step 2: Intersect parent/clinician results with monitor
    pcm_overlap = intersect_two_lists(pc_overlap, monitor_avail)
    
    # Return the first available matching slot
    if pcm_overlap:
        first_slot = pcm_overlap[0]
        # Return a slot matching the exact duration required
        slot_start = first_slot["start"]
        slot_end = slot_start + min_duration
        return {
            "start": slot_start.isoformat(),
            "end": slot_end.isoformat()
        }

    return None


def _intersect(list1, list2, min_duration):
    """Intersect two lists of {start,end} interval dicts, returning datetime intervals."""
    out = []
    for a in list1:
        try:
            s1, e1 = parse_iso(a["start"]), parse_iso(a["end"])
        except Exception:
            continue
        for b in list2:
            try:
                s2, e2 = parse_iso(b["start"]), parse_iso(b["end"])
            except Exception:
                continue
            os_, oe = max(s1, s2), min(e1, e2)
            if oe - os_ >= min_duration:
                out.append({"start": os_, "end": oe})
    return out


def calculate_conflict_free_slots(parent_avail, clinician_avail, monitor_avail,
                                  duration_hours=1, max_slots=3):
    """
    Agent 1's slot calculator. Intersects the parent, clinician, and court-monitor
    windows and returns up to `max_slots` chronological, conflict-free options,
    each exactly `duration_hours` long. Each option: {start, end, label}.
    """
    min_duration = timedelta(hours=duration_hours)
    pcm = _intersect(_intersect(parent_avail, clinician_avail, min_duration),
                     monitor_avail, min_duration)
    # earliest first, de-duplicated by start time
    pcm.sort(key=lambda w: w["start"])
    slots, seen = [], set()
    for window in pcm:
        start = window["start"]
        # anchor to the top of the hour for clean invites
        if start.minute or start.second:
            start = start.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        end = start + min_duration
        if end > window["end"]:
            continue
        key = start.isoformat()
        if key in seen:
            continue
        seen.add(key)
        slots.append({
            "start": start.isoformat(),
            "end": end.isoformat(),
            "label": start.strftime("%a %b %d, %I:%M %p").replace(" 0", " "),
        })
        if len(slots) >= max_slots:
            break
    return slots
