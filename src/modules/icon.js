import React from 'react';
import { Icon } from '@iconify/react';

const IconContained = ({
	className,
	size,
	icon,
	iconClasses,
	...iconProps
}) => {
	return (
		<span
			className={`
				inline-block align-middle
				${className ?? ''}
				${size ?? ''}
			`}
		>
			<Icon
				icon={icon}
				className={`
					${iconClasses ?? ''}
					${size ?? ''}
				`}
				{...iconProps}
			/>
		</span>
	);
};

export default IconContained;