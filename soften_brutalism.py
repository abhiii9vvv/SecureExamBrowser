import os

# The HTML files to modify
html_files = [
    'ui/login.html', 'ui/launch.html', 'ui/verification.html', 'ui/student-dashboard.html',
    'ui/exam.html', 'ui/submission.html', 'ui/dashboard.html', 'ui/admin-users.html',
    'ui/admin-exams.html', 'ui/admin-reports.html'
]

# Toning down the brutalism shadows and borders
replacements = {
    'shadow-[16px_16px_0px_0px_rgba(0,0,0,1)]': 'shadow-[8px_8px_0px_0px_#000]',
    'shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]': 'shadow-[6px_6px_0px_0px_#000]',
    'shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]': 'shadow-[4px_4px_0px_0px_#000]',
    'shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]': 'shadow-[2px_2px_0px_0px_#000]',
    'shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]': 'shadow-[1px_1px_0px_0px_#000]',
    'border-8': 'border-4',
    'border-4': 'border-2',
    'border-2': 'border',
    'uppercase': 'tracking-wide', # tone down the excessive uppercase/tracking? Just leave uppercase.
    # We will let typography stand, but reduce the visual fat
}

for file in html_files:
    if os.path.exists(file):
        with open(file, 'r', encoding='utf-8') as f:
            content = f.read()
            
        for old, new in replacements.items():
            content = content.replace(old, new)
            
        with open(file, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Softened brutalism in {file}")
