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
