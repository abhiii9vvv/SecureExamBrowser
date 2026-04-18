import os
import re

html_files = [
    'ui/login.html', 'ui/launch.html', 'ui/verification.html', 'ui/student-dashboard.html',
    'ui/exam.html', 'ui/submission.html', 'ui/dashboard.html', 'ui/admin-users.html',
    'ui/admin-exams.html', 'ui/admin-reports.html'
]

def fix_corruptions(content):
    # Fix uppercase replacements
    content = content.replace("tracking-wide tracking-tight", "uppercase tracking-tight")
    content = content.replace("tracking-wide tracking-wider", "uppercase tracking-wider")
    content = content.replace("tracking-wide tracking-widest", "uppercase tracking-widest")
    content = content.replace("font-black tracking-wide", "font-black uppercase")
    content = content.replace("font-bold tracking-wide", "font-bold uppercase")
    content = content.replace("text-xs font-bold tracking-wide", "text-xs font-bold uppercase")
    content = content.replace("tracking-wide tracking-wide", "uppercase tracking-wide")
    
    # Fix the missing tracking-wide (it replaced 'uppercase', so standing alone 'tracking-wide' might be 'uppercase')
    content = re.sub(r'(class="[^"]*)\btracking-wide\b([^"]*")', lambda m: m.group(0) if 'uppercase' in m.group(0) else m.group(1) + 'uppercase' + m.group(2), content)

    # Fix borders: border -> border-2
    # We want to replace `border ` with `border-2 `
    content = content.replace(' border border-border', ' border-2 border-border')
    content = content.replace(' border border-transparent', ' border-2 border-transparent')
    content = content.replace(' border ', ' border-2 ')
    
    # But clean up any `border-2-2`
    content = content.replace('border-2-2', 'border-2')
    content = content.replace('border-b ', 'border-b-2 ')
    content = content.replace('border-t ', 'border-t-2 ')
    content = content.replace('border-l ', 'border-l-2 ')
    content = content.replace('border-r ', 'border-r-2 ')

    # Fix shadow reductions: 
    # original shadows were up to 16px. I want a tasteful 50% brutalism.
    # The current ones in HTML are likely shadow-[1px... or shadow-[2px...
    return content

for file in html_files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
            
        content = fix_corruptions(content)
            
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed corruptions in {file}")
