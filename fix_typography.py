import os
import re

html_files = [
    'ui/login.html', 'ui/launch.html', 'ui/verification.html', 'ui/student-dashboard.html',
    'ui/exam.html', 'ui/submission.html', 'ui/dashboard.html', 'ui/admin-users.html',
    'ui/admin-exams.html', 'ui/admin-reports.html'
]

def soften_typography(content):
    # 1. Remove uppercase entirely from large headers and standard text.
    # We will just strip " uppercase " from class strings, taking care of edges.
    content = re.sub(r'\buppercase\b\s*', '', content)
    
    # 2. Remove tracking-tight globally because the user hates the "compact" text.
    content = re.sub(r'\btracking-tight\b\s*', '', content)
    
    # 3. Increase tracking (letter-spacing) slightly where it was too wide or just remove them to let default font breathe
    content = re.sub(r'\btracking-widest\b\s*', 'tracking-wider ', content)
    
    # 4. If there's multiple spaces in classes from removal, clean it up (optional but nice)
    content = re.sub(r'\s+', ' ', content)
    # the above replaces all newlines! BAD.
    # ONLY do it inside class="..."
    return content

for file in html_files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Clean typography inside classes ONLY
        def replacer(match):
            cls = match.group(0)
            cls = re.sub(r'\buppercase\b', '', cls)
            cls = re.sub(r'\btracking-tight\b', '', cls)
            cls = re.sub(r'\btracking-widest\b', 'tracking-wide', cls) # reduce the ultra wide tracking
            cls = re.sub(r'\s+', ' ', cls) # clean spaces
            return cls
        
        # apply to all class="... " attributes
        content = re.sub(r'class="[^"]*"', replacer, content)
            
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Fixed typography in {file}")
